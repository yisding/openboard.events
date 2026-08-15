import { and, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import {
  adminAuthEmailOutbox,
  adminLoginAttempts,
  adminSessions,
  adminVerifications,
  calendarCancellationJobs,
  communicationLogs,
  portalSessions,
  portalTokens,
  rateLimitBuckets,
} from "@/db/schema";
import type { JobStats } from "@/shared/contracts";

/**
 * M47 — retention for the three data classes the roadmap names: expired
 * tokens, expired sessions, and rendered email bodies. Wired into the
 * existing private cleanup job beside M08/P3-OPS's R2 orphan
 * sweep — same job slot, same "independent statements, no wrapping
 * transaction" shape as `cleanupOrphans` already uses for its own two
 * sweeps: a crash mid-sweep just leaves the remaining rows for the next
 * daily tick rather than corrupting anything, so this is deliberately not a
 * 10th `withTx`-audited function.
 *
 * Grace windows keep a just-expired row available for a short
 * support/abuse-investigation window before it is physically removed — they
 * are wider than the row's own TTL, never a substitute for it. A
 * `portal_tokens`/`admin_sessions` row is already useless for authentication
 * the moment `expires_at` passes; the grace period is about *retaining* it
 * a little longer for someone to look at, not about extending its validity.
 *
 * `admin_verifications` (Better Auth's password-reset/email-verification/
 * OAuth-state rows, M42) is the admin-side counterpart to `portal_tokens` —
 * both are "expired tokens" in the roadmap's sense, just on the two
 * different auth stacks this codebase runs (DECISIONS.md, "Product auth
 * direction"). `organization_invitations` is deliberately NOT included:
 * unlike the four tables below, it carries ongoing business value (an
 * organizer's own record of who they invited and when) even after its
 * token expires, and M44 already owns its lifecycle (`revokeOrganizationInvitation`).
 *
 * The two abuse-counter tables (`rate_limit_buckets`,
 * `admin_login_attempts`) are swept here too. Neither had any deletion path:
 * every distinct caller key ever seen left a permanent row, and those keys
 * are hashes of guessable material (an IP address, an email address) — the
 * exact unkeyed-digest-of-a-guessable-value shape `operational-errors.ts`
 * refuses to retain. Dropping an idle row is behaviour-preserving: the
 * longest window any caller passes is 10 minutes, so a row untouched for
 * days would take the reset branch of its own CASE-upsert on the next touch
 * anyway, and `checkRateLimit` already declares the counter best-effort.
 * `admin_login_attempts` is additionally gated on `blocked_until` so an
 * active 15-minute block is never cleared early.
 */
const TOKEN_GRACE_DAYS = 30;
const SESSION_GRACE_DAYS = 30;
const RENDERED_BODY_RETENTION_DAYS = 90;
const ABUSE_COUNTER_RETENTION_DAYS = 7;

function daysAgo(days: number, now: Date): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

export type DataRetentionStats = JobStats & {
  expiredPortalTokens: number;
  expiredAdminVerifications: number;
  expiredPortalSessions: number;
  expiredAdminSessions: number;
  redactedCommunicationLogs: number;
  redactedAdminAuthEmails: number;
  removedStaleCalendarCancellationJobs: number;
  staleRateLimitBuckets: number;
  staleAdminLoginAttempts: number;
};

export async function runDataRetentionSweepIn(dbOrTx: DbOrTx, now: Date = new Date()): Promise<DataRetentionStats> {
  const tokenCutoff = daysAgo(TOKEN_GRACE_DAYS, now);
  const sessionCutoff = daysAgo(SESSION_GRACE_DAYS, now);
  const bodyCutoff = daysAgo(RENDERED_BODY_RETENTION_DAYS, now);
  const counterCutoff = daysAgo(ABUSE_COUNTER_RETENTION_DAYS, now);

  const expiredPortalTokens = await dbOrTx.delete(portalTokens).where(lt(portalTokens.expiresAt, tokenCutoff)).returning();
  const expiredAdminVerifications = await dbOrTx.delete(adminVerifications).where(lt(adminVerifications.expiresAt, tokenCutoff)).returning();
  const expiredPortalSessions = await dbOrTx.delete(portalSessions).where(lt(portalSessions.expiresAt, sessionCutoff)).returning();
  const expiredAdminSessions = await dbOrTx.delete(adminSessions).where(lt(adminSessions.expiresAt, sessionCutoff)).returning();
  const staleRateLimitBuckets = await dbOrTx.delete(rateLimitBuckets).where(lt(rateLimitBuckets.updatedAt, counterCutoff)).returning();
  const staleAdminLoginAttempts = await dbOrTx.delete(adminLoginAttempts)
    .where(and(
      lt(adminLoginAttempts.updatedAt, counterCutoff),
      or(isNull(adminLoginAttempts.blockedUntil), lt(adminLoginAttempts.blockedUntil, now)),
    ))
    .returning();

  // Redact content, keep the row: `communication_logs` is the comms audit
  // trail (status, template, timestamps) that the deliverability dashboard
  // and comms log UI read indefinitely — only the PII-bearing rendered
  // content ages out. `secretPayloadCiphertext` is already redacted at
  // terminal status by the dispatcher (PLAN resolution #12); this is
  // defense-in-depth for anything that slipped through, not the primary path.
  const redacted = await dbOrTx.update(communicationLogs)
    .set({ subjectRendered: null, bodyRenderedHtml: null, secretPayloadCiphertext: null })
    .where(and(
      lt(communicationLogs.createdAt, bodyCutoff),
      or(
        isNotNull(communicationLogs.subjectRendered),
        isNotNull(communicationLogs.bodyRenderedHtml),
        isNotNull(communicationLogs.secretPayloadCiphertext),
      ),
    ))
    .returning();
  // The platform outbox holds the same content as `communication_logs` — a
  // rendered subject and body, and on a failed row the sealed payload carrying
  // the reset or verification link — and nothing aged any of it out. Same
  // boundary, same rule: the delivery record survives as the audit trail, the
  // content does not. The recipient address stays, because the bounce and
  // complaint lookup in `admin-mail.ts` is keyed on it.
  const redactedAdminAuthEmails = await dbOrTx.update(adminAuthEmailOutbox)
    .set({ subjectRendered: null, bodyRenderedHtml: null, secretPayloadCiphertext: null })
    .where(and(
      lt(adminAuthEmailOutbox.createdAt, bodyCutoff),
      or(
        isNotNull(adminAuthEmailOutbox.subjectRendered),
        isNotNull(adminAuthEmailOutbox.bodyRenderedHtml),
        isNotNull(adminAuthEmailOutbox.secretPayloadCiphertext),
      ),
    ))
    .returning();

  // A cancellation snapshot is active delivery state while its parent log is
  // queued, including during provider backoff. Terminal rows should already be
  // cleaned by the dispatcher; this sweep removes any old residue so attendee
  // PII follows the same 90-day boundary as rendered mail content.
  const staleCancellationJobs = await dbOrTx.delete(calendarCancellationJobs)
    .where(inArray(
      calendarCancellationJobs.communicationLogId,
      dbOrTx.select({ id: communicationLogs.id }).from(communicationLogs).where(and(
        lt(communicationLogs.createdAt, bodyCutoff),
        inArray(communicationLogs.status, ["sent", "skipped", "failed"]),
      )),
    ))
    .returning();

  return {
    expiredPortalTokens: expiredPortalTokens.length,
    expiredAdminVerifications: expiredAdminVerifications.length,
    expiredPortalSessions: expiredPortalSessions.length,
    expiredAdminSessions: expiredAdminSessions.length,
    redactedCommunicationLogs: redacted.length,
    redactedAdminAuthEmails: redactedAdminAuthEmails.length,
    removedStaleCalendarCancellationJobs: staleCancellationJobs.length,
    staleRateLimitBuckets: staleRateLimitBuckets.length,
    staleAdminLoginAttempts: staleAdminLoginAttempts.length,
  };
}

export function runDataRetentionSweep(now?: Date): Promise<DataRetentionStats> {
  return runDataRetentionSweepIn(db, now);
}
