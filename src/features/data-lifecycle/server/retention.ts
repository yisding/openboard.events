import { and, isNotNull, lt, or } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { adminSessions, adminVerifications, communicationLogs, portalSessions, portalTokens } from "@/db/schema";
import type { JobStats } from "@/shared/contracts";

/**
 * M47 — retention for the three data classes the roadmap names: expired
 * tokens, expired sessions, and rendered email bodies. Wired into the
 * existing cleanup cron (`/api/jobs/cleanup`) beside M08/P3-OPS's R2 orphan
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
 */
const TOKEN_GRACE_DAYS = 30;
const SESSION_GRACE_DAYS = 30;
const RENDERED_BODY_RETENTION_DAYS = 90;

function daysAgo(days: number, now: Date): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

export type DataRetentionStats = JobStats & {
  expiredPortalTokens: number;
  expiredAdminVerifications: number;
  expiredPortalSessions: number;
  expiredAdminSessions: number;
  redactedCommunicationLogs: number;
};

export async function runDataRetentionSweepIn(dbOrTx: DbOrTx, now: Date = new Date()): Promise<DataRetentionStats> {
  const tokenCutoff = daysAgo(TOKEN_GRACE_DAYS, now);
  const sessionCutoff = daysAgo(SESSION_GRACE_DAYS, now);
  const bodyCutoff = daysAgo(RENDERED_BODY_RETENTION_DAYS, now);

  const expiredPortalTokens = await dbOrTx.delete(portalTokens).where(lt(portalTokens.expiresAt, tokenCutoff)).returning();
  const expiredAdminVerifications = await dbOrTx.delete(adminVerifications).where(lt(adminVerifications.expiresAt, tokenCutoff)).returning();
  const expiredPortalSessions = await dbOrTx.delete(portalSessions).where(lt(portalSessions.expiresAt, sessionCutoff)).returning();
  const expiredAdminSessions = await dbOrTx.delete(adminSessions).where(lt(adminSessions.expiresAt, sessionCutoff)).returning();

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

  return {
    expiredPortalTokens: expiredPortalTokens.length,
    expiredAdminVerifications: expiredAdminVerifications.length,
    expiredPortalSessions: expiredPortalSessions.length,
    expiredAdminSessions: expiredAdminSessions.length,
    redactedCommunicationLogs: redacted.length,
  };
}

export function runDataRetentionSweep(now?: Date): Promise<DataRetentionStats> {
  return runDataRetentionSweepIn(db, now);
}
