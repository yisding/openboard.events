import { and, asc, desc, eq, gt, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { adminAuthEmailOutbox, events, organizationInvitations } from "@/db/schema";
import { organizationInvitationIdSchema, type TemplateKey, type UserId } from "@/shared/contracts";
import { AppError, isAppError } from "@/shared/lib/errors";
import { getEnv, type RuntimeEnv } from "@/shared/lib/env";
import { log } from "@/shared/lib/log";
import { isEmailAllowed } from "@/shared/server/email-allowlist";
import { assertOrganizationInvitationTokenForEmailIn } from "@/features/organizations/index.invitations";
import { escapeHtml } from "@/shared/lib/html";
import { openPlatformAdminLinkPayload, sealPlatformAdminLinkPayload, type AdminLinkPayload } from "@/shared/server/admin-link-payload";
import { emailLayout } from "@/shared/server/email-layout";
import { sendViaResend, type EmailMessage } from "@/shared/server/email-provider";
import {
  compareOutboxRows,
  drainOutbox,
  outboxErrorMessage,
  type OutboxDispatchStats,
  type OutboxFailureTransition,
} from "@/shared/server/outbox-engine";
import { SIGNUP_VERIFICATION_CALLBACK } from "../signup-context";

export type AdminAuthTemplateKey = Extract<TemplateKey, "admin_password_reset" | "admin_email_verification">;
type OutboxRow = typeof adminAuthEmailOutbox.$inferSelect;
type Sender = (message: EmailMessage) => Promise<string>;
export type AdminAuthOutboxStats = OutboxDispatchStats;

const TEMPLATES: Record<AdminAuthTemplateKey, {
  subject: string;
  intro: string;
  action: string;
  outro: string;
}> = {
  admin_email_verification: {
    subject: "Confirm your email for Openboard",
    intro: "Confirm this address to finish setting up your Openboard account.",
    action: "Confirm your email",
    outro: "If you did not create this account, you can ignore this email.",
  },
  admin_password_reset: {
    subject: "Reset your Openboard password",
    intro: "Someone asked to reset the password for your Openboard account.",
    action: "Choose a new password",
    outro: "If this was not you, you can ignore this email — your password has not changed.",
  },
};

/**
 * First Fair — the demo mail barrier's **second** outbox.
 *
 * `admin_auth_email_outbox` is drained by this module, not by the comms
 * dispatcher, so `buildContext`'s `events.is_demo` guard never sees a row that
 * lands here. Reviewer invitations are event-scoped and therefore the one
 * template key that can name a demo event, and `inviteEventReviewerIn` already
 * refuses those at the writer. This is the symmetric barrier behind it: the
 * product's claim is "no email ever leaves the building", and a claim that
 * depends on exactly one writer remembering is not a rail.
 *
 * The reason text is duplicated from `@/features/comms`'s
 * `DEMO_MAIL_SKIP_REASON` rather than imported: `comms -> auth` already exists,
 * and the reverse edge would be a feature cycle. `check-source-invariants.ts`
 * pins the literal in both files so they cannot drift apart.
 */
const DEMO_MAIL_SKIP_REASON = "demo event — mail is never delivered";

async function namesDemoEventIn(dbOrTx: DbOrTx, invitationId: string): Promise<boolean> {
  const [row] = await dbOrTx.select({ isDemo: events.isDemo })
    .from(organizationInvitations)
    .innerJoin(events, eq(events.id, organizationInvitations.eventId))
    .where(eq(organizationInvitations.id, invitationId))
    .limit(1);
  return row?.isDemo === true;
}

function requiredSecret(env: RuntimeEnv): string {
  if (!env.SESSION_SECRET) throw new AppError("INTERNAL", "SESSION_SECRET is required for admin auth mail");
  return env.SESSION_SECRET;
}

function adminAuthFallbackEnabled(env: RuntimeEnv): boolean {
  return env.APP_ENV !== "production" && env.EMAIL_FALLBACK_UI === "1";
}

function retainsVerificationFallback(row: OutboxRow, env: RuntimeEnv): boolean {
  return row.templateKey === "admin_email_verification" && adminAuthFallbackEnabled(env);
}

function render(row: OutboxRow, payload: AdminLinkPayload): { subject: string; html: string; text: string } {
  if (row.templateKey === "organization_invited") {
    if (!payload.organizationName || !payload.inviterName || !payload.invitationRole) {
      throw new AppError("VALIDATION", "Organization invitation payload is incomplete");
    }
    const organizationName = payload.organizationName;
    const inviterName = payload.inviterName;
    const role = payload.invitationRole;
    if (payload.eventName) {
      const eventName = payload.eventName;
      const subject = `You're invited to review ${eventName}`.replace(/[\r\n]+/gu, " ");
      const body = `<p>Hi,</p><p>${escapeHtml(inviterName)} invited you to review proposals for <strong>${escapeHtml(eventName)}</strong> in ${escapeHtml(organizationName)}.</p><p><a href="${escapeHtml(payload.url)}">Accept the reviewer invitation</a>. Sign in or create your own account with this email address. The link expires ${escapeHtml(payload.expiresIn)}.</p><p>If you were not expecting this, you can ignore this email.</p>`;
      const html = emailLayout(body, "organization_invited", { eventName: escapeHtml(eventName) });
      const text = `Hi,\n\n${inviterName} invited you to review proposals for ${eventName} in ${organizationName}.\n\nAccept the reviewer invitation: ${payload.url}\nSign in or create your own account with this email address.\nThe link expires ${payload.expiresIn}.\n\nIf you were not expecting this, you can ignore this email.\n\nOpenboard`;
      return { subject, html, text };
    }
    const roleWithArticle = role === "organizer" ? "an organizer" : "a reviewer";
    const subject = `You're invited to join ${organizationName}`.replace(/[\r\n]+/gu, " ");
    const body = `<p>Hi,</p><p>${escapeHtml(inviterName)} invited you to join <strong>${escapeHtml(organizationName)}</strong> on Openboard as ${roleWithArticle}.</p><p><a href="${escapeHtml(payload.url)}">Accept the invitation</a>. The link expires ${escapeHtml(payload.expiresIn)}.</p><p>If you were not expecting this, you can ignore this email.</p>`;
    const html = emailLayout(body, "organization_invited", { eventName: escapeHtml(organizationName) });
    const text = `Hi,\n\n${inviterName} invited you to join ${organizationName} on Openboard as ${roleWithArticle}.\n\nAccept the invitation: ${payload.url}\nThe link expires ${payload.expiresIn}.\n\nIf you were not expecting this, you can ignore this email.\n\nOpenboard`;
    return { subject, html, text };
  }
  const template = TEMPLATES[row.templateKey as AdminAuthTemplateKey];
  if (!template) throw new AppError("VALIDATION", "Unsupported admin auth email template");
  const name = row.recipientName.trim();
  const greeting = name ? `<p>Hi ${escapeHtml(name)},</p>` : "<p>Hi,</p>";
  const body = `${greeting}<p>${template.intro}</p><p><a href="${escapeHtml(payload.url)}">${template.action}</a>. The link expires in ${escapeHtml(payload.expiresIn)}.</p><p>${template.outro}</p>`;
  const html = emailLayout(body, row.templateKey as AdminAuthTemplateKey, { eventName: "Openboard" });
  const text = `${name ? `Hi ${name},\n\n` : "Hi,\n\n"}${template.intro}\n\n${template.action}: ${payload.url}\nThis link expires in ${payload.expiresIn}.\n\n${template.outro}\n\nOpenboard`;
  return { subject: template.subject, html, text };
}

function redactCredentials(value: string): string {
  return value
    .replace(/([?&](?:amp;)?token=)[^"'&\s<]+/giu, "$1[redacted]")
    // A preserved auth destination can itself contain an invitation token.
    // URLSearchParams encodes its `?token=` delimiter inside `next`; redact
    // that second bearer value from persisted rendered history as well.
    //
    // The delimiter is matched at any encoding depth (`%(?:25)*3f`). Password
    // reset encodes `next` exactly once, so `%3Ftoken%3D` was all this pattern
    // ever saw — and that is the only shape the existing test fixture builds.
    // Verification mail encodes twice: `existingSignupVerificationCallback`
    // (better-auth.ts:109) already percent-encodes `next`, and the whole
    // `callbackURL` is encoded again by `URLSearchParams` at better-auth.ts:197
    // (Better Auth's own signup path does the same), producing
    // `next%3D%252Fjoin%253Ftoken%253D<raw>`. A single-depth pattern missed it,
    // so every invited-but-unverified user's confirmation mail persisted a live
    // `/join` bearer token in `body_rendered_html` — the one value the sealed
    // payload is nulled on send (`:319`) specifically to avoid retaining — until
    // retention blanked the body 90 days later.
    .replace(/((?:%(?:25)*3f|%(?:25)*26)token%(?:25)*3d)[^"'&\s<%]+/giu, "$1[redacted]");
}

export async function sendAdminAuthEmailIn(
  dbOrTx: DbOrTx,
  args: {
    templateKey: AdminAuthTemplateKey;
    userId: UserId;
    email: string;
    name: string;
    url: string;
    expiresIn: string;
    /** Keep a just-created user's first link out of the claim loop until provisioning can retarget it. */
    notBefore?: Date;
  },
  env: RuntimeEnv = getEnv(),
): Promise<{ queued: true; messageId: string }> {
  const messageId = crypto.randomUUID();
  const secretPayloadCiphertext = await sealPlatformAdminLinkPayload(
    { url: args.url, expiresIn: args.expiresIn },
    { userId: args.userId, messageId },
    requiredSecret(env),
  );
  await dbOrTx.insert(adminAuthEmailOutbox).values({
    id: messageId,
    userId: args.userId,
    recipientEmail: args.email.trim().toLowerCase(),
    recipientName: args.name.trim(),
    templateKey: args.templateKey,
    idempotencyKey: `admin-auth:${args.templateKey}:${args.userId}:${messageId}`,
    secretPayloadCiphertext,
    ...(args.notBefore ? { nextAttemptAt: args.notBefore } : {}),
  });
  return { queued: true, messageId };
}

export const sendAdminAuthEmail = (args: Parameters<typeof sendAdminAuthEmailIn>[1], env?: RuntimeEnv) =>
  sendAdminAuthEmailIn(db, args, env ?? getEnv());

/**
 * The automatic signup email is queued before Better Auth runs its user-create
 * `after` hook. Once that hook has provisioned the workspace and any invited
 * event access, replace the neutral callback in the still-encrypted link and
 * release the row for claim.
 * A one-minute `notBefore` fallback on the original row prevents a cron race;
 * if this update ever fails, the generic `/organizations` route remains a
 * working (slightly delayed) recovery destination.
 */
export async function retargetSignupVerificationEmailIn(
  dbOrTx: DbOrTx,
  userId: UserId,
  destination: string,
  env: RuntimeEnv = getEnv(),
): Promise<number> {
  const rows = await dbOrTx.select().from(adminAuthEmailOutbox).where(and(
    eq(adminAuthEmailOutbox.userId, userId),
    eq(adminAuthEmailOutbox.templateKey, "admin_email_verification"),
    eq(adminAuthEmailOutbox.status, "queued"),
  ));
  let updated = 0;
  for (const row of rows) {
    if (!row.secretPayloadCiphertext) continue;
    const payload = await openPlatformAdminLinkPayload(
      row.secretPayloadCiphertext,
      { userId, messageId: row.id },
      requiredSecret(env),
    );
    const verificationUrl = new URL(payload.url);
    if (verificationUrl.searchParams.get("callbackURL") !== SIGNUP_VERIFICATION_CALLBACK) continue;
    verificationUrl.searchParams.set(
      "callbackURL",
      `/signup/verified?confirmed=1&next=${encodeURIComponent(destination)}`,
    );
    const secretPayloadCiphertext = await sealPlatformAdminLinkPayload(
      { ...payload, url: verificationUrl.toString() },
      { userId, messageId: row.id },
      requiredSecret(env),
    );
    const changed = await dbOrTx.update(adminAuthEmailOutbox).set({
      secretPayloadCiphertext,
      nextAttemptAt: sql`now()`,
    }).where(and(
      eq(adminAuthEmailOutbox.id, row.id),
      eq(adminAuthEmailOutbox.status, "queued"),
    )).returning();
    updated += changed.length;
  }
  return updated;
}

async function claimRows(dbOrTx: DbOrTx, budget: number): Promise<OutboxRow[]> {
  const candidates = dbOrTx.select({ id: adminAuthEmailOutbox.id }).from(adminAuthEmailOutbox).where(and(
    eq(adminAuthEmailOutbox.status, "queued"),
    lte(adminAuthEmailOutbox.nextAttemptAt, sql`now()`),
    or(isNull(adminAuthEmailOutbox.lockedUntil), lt(adminAuthEmailOutbox.lockedUntil, sql`now()`)),
  )).orderBy(asc(adminAuthEmailOutbox.createdAt), asc(adminAuthEmailOutbox.id)).limit(budget).for("update", { skipLocked: true });
  const rows = await dbOrTx.update(adminAuthEmailOutbox).set({
    lockedUntil: sql`now() + interval '3 minutes'`,
    attempts: sql`${adminAuthEmailOutbox.attempts} + 1`,
  }).where(inArray(adminAuthEmailOutbox.id, candidates)).returning();
  return rows.sort(compareOutboxRows);
}

function terminal(_row: OutboxRow, error: unknown): boolean {
  if (isAppError(error) && error.code === "VALIDATION") return true;
  return false;
}

async function failRow(
  dbOrTx: DbOrTx,
  row: OutboxRow,
  transition: OutboxFailureTransition,
): Promise<void> {
  const isTerminal = transition.outcome === "failed";
  await dbOrTx.update(adminAuthEmailOutbox).set({
    status: isTerminal ? "failed" : "queued",
    error: transition.errorMessage,
    lockedUntil: null,
    ...(isTerminal
      // A rotated SESSION_SECRET and a malformed payload both surface as a
      // terminal validation failure. Keep the still-encrypted bearer value so
      // an operator with the previous key can diagnose/requeue the row; sent,
      // skipped, and allowlist-rejected rows still erase it immediately.
      ? {}
      : { nextAttemptAt: sql`now() + ${transition.retryDelayMinutes} * interval '1 minute'` }),
  }).where(eq(adminAuthEmailOutbox.id, row.id));
}

async function skipRow(
  dbOrTx: DbOrTx,
  row: OutboxRow,
  reason: string,
  retainCredential = false,
): Promise<"skipped"> {
  await dbOrTx.update(adminAuthEmailOutbox).set({
    status: "skipped",
    error: reason,
    lockedUntil: null,
    ...(retainCredential ? {} : { secretPayloadCiphertext: null }),
  }).where(eq(adminAuthEmailOutbox.id, row.id));
  return "skipped";
}

async function deliver(dbOrTx: DbOrTx, row: OutboxRow, env: RuntimeEnv, sender: Sender): Promise<"sent" | "skipped"> {
  const retainFallback = retainsVerificationFallback(row, env);
  const [suppressed] = await dbOrTx.select({ id: adminAuthEmailOutbox.id }).from(adminAuthEmailOutbox).where(and(
    eq(adminAuthEmailOutbox.recipientEmail, row.recipientEmail),
    inArray(adminAuthEmailOutbox.status, ["bounced", "complained"]),
    // Complaints are permanent. A bounce may be transient (mailbox full or a
    // temporary receiving-domain failure), so it ages out instead of locking
    // the account out of password recovery forever.
    or(
      eq(adminAuthEmailOutbox.status, "complained"),
      gt(adminAuthEmailOutbox.suppressedAt, sql`now() - interval '30 days'`),
    ),
  )).limit(1);
  if (suppressed) {
    return skipRow(dbOrTx, row, "recipient suppressed after bounce or complaint", retainFallback);
  }
  // Above the allowlist and above the sealed payload, for the same reason
  // `buildContext` puts its copy there: a demo row must never open a
  // credential or consult a provider, whatever the environment is configured
  // to do. See `DEMO_MAIL_SKIP_REASON` above.
  if (row.templateKey === "organization_invited") {
    const invited = organizationInvitationIdSchema.safeParse(row.idempotencyKey.split(":")[2]);
    if (invited.success && await namesDemoEventIn(dbOrTx, invited.data)) {
      return skipRow(dbOrTx, row, DEMO_MAIL_SKIP_REASON);
    }
  }
  if (!isEmailAllowed(row.recipientEmail, env)) {
    return skipRow(dbOrTx, row, "not in EMAIL_ALLOWLIST", retainFallback);
  }
  if (!row.secretPayloadCiphertext) throw new AppError("VALIDATION", "Platform email link payload is missing");
  const payload = await openPlatformAdminLinkPayload(
    row.secretPayloadCiphertext,
    { userId: row.userId as UserId, messageId: row.id },
    requiredSecret(env),
  );
  if (row.templateKey === "organization_invited") {
    const invitationId = organizationInvitationIdSchema.safeParse(row.idempotencyKey.split(":")[2]);
    let token = "";
    try {
      const actionUrl = new URL(payload.url);
      if (actionUrl.origin !== new URL(env.APP_BASE_URL).origin || actionUrl.pathname !== "/join") {
        throw new Error("unexpected invitation destination");
      }
      token = actionUrl.searchParams.get("token")?.trim() ?? "";
    } catch {
      throw new AppError("VALIDATION", "Organization invitation link is invalid");
    }
    if (!invitationId.success || !token) throw new AppError("VALIDATION", "Organization invitation outbox key is malformed");
    try {
      await assertOrganizationInvitationTokenForEmailIn(dbOrTx, token, row.recipientEmail);
    } catch (error) {
      if (isAppError(error) && (error.code === "VALIDATION" || error.code === "FORBIDDEN")) {
        return skipRow(dbOrTx, row, "organization invitation is no longer pending");
      }
      throw error;
    }
  }
  const rendered = render(row, payload);
  const keepCredential = env.APP_ENV !== "production" && env.EMAIL_MODE === "log" && env.EMAIL_FALLBACK_UI === "1";
  await dbOrTx.update(adminAuthEmailOutbox).set({
    subjectRendered: rendered.subject,
    bodyRenderedHtml: keepCredential ? rendered.html : redactCredentials(rendered.html),
  }).where(eq(adminAuthEmailOutbox.id, row.id));

  let providerMessageId = "log-mode";
  if (env.EMAIL_MODE === "send") {
    if (!env.RESEND_API_KEY || !env.EMAIL_FROM) throw new Error("email sending is not configured");
    const apiKey = env.RESEND_API_KEY;
    const from = env.EMAIL_FROM;
    providerMessageId = await sender({
      apiKey,
      from,
      to: row.recipientEmail,
      ...(env.EMAIL_REPLY_TO ? { replyTo: env.EMAIL_REPLY_TO } : {}),
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      idempotencyKey: row.idempotencyKey,
    });
  }
  await dbOrTx.update(adminAuthEmailOutbox).set({
    status: "sent",
    providerMessageId,
    sentAt: sql`now()`,
    error: null,
    lockedUntil: null,
    secretPayloadCiphertext: retainFallback ? row.secretPayloadCiphertext : null,
  }).where(eq(adminAuthEmailOutbox.id, row.id));
  return "sent";
}

export async function dispatchAdminAuthEmailOutboxIn(
  dbOrTx: DbOrTx,
  budget = 50,
  options?: { env?: RuntimeEnv; sender?: Sender },
): Promise<AdminAuthOutboxStats> {
  const env = options?.env ?? getEnv();
  const sender = options?.sender ?? ((message: EmailMessage) => sendViaResend(message));
  return drainOutbox({
    requestedBudget: budget,
    claim: (claimBudget) => claimRows(dbOrTx, claimBudget),
    deliver: (row) => deliver(dbOrTx, row, env, sender),
    deliveryKey: (row) => row.recipientEmail,
    isTerminalError: terminal,
    transitionFailure: (row, transition) => failRow(dbOrTx, row, transition),
  });
}

export function dispatchAdminAuthEmailOutbox(budget = 50): Promise<AdminAuthOutboxStats> {
  return dispatchAdminAuthEmailOutboxIn(db, budget);
}

/** The same explicit non-production escape hatch as speaker portal login. */
export async function getAdminAuthFallbackLinkIn(
  dbOrTx: DbOrTx,
  email: string,
  env: RuntimeEnv = getEnv(),
): Promise<string | null> {
  if (!adminAuthFallbackEnabled(env)) return null;
  const [row] = await dbOrTx.select().from(adminAuthEmailOutbox).where(and(
    eq(adminAuthEmailOutbox.recipientEmail, email.trim().toLowerCase()),
    eq(adminAuthEmailOutbox.templateKey, "admin_email_verification"),
  )).orderBy(desc(adminAuthEmailOutbox.createdAt), desc(adminAuthEmailOutbox.id)).limit(1);
  if (!row) return null;
  if (row.secretPayloadCiphertext) {
    const payload = await openPlatformAdminLinkPayload(
      row.secretPayloadCiphertext,
      { userId: row.userId as UserId, messageId: row.id },
      requiredSecret(env),
    );
    return payload.url;
  }
  const href = /<a\s+href="([^"]+)"/iu.exec(row.bodyRenderedHtml ?? "")?.[1];
  if (!href) return null;
  // `&amp;` last: decoding it first would let an escaped `&amp;quot;` collapse
  // into a bare `"` and cut the recovered link short.
  const decoded = href.replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&amp;", "&");
  try {
    const url = new URL(decoded);
    return url.searchParams.has("token") ? url.toString() : null;
  } catch {
    return null;
  }
}

export function getAdminAuthFallbackLink(email: string): Promise<string | null> {
  return getAdminAuthFallbackLinkIn(db, email);
}

/** Provider bounce/complaint target for product-level auth messages. */
export async function recordAdminAuthEmailSuppressionIn(
  dbOrTx: DbOrTx,
  args: { providerMessageId: string; reason: "bounce" | "complaint" },
): Promise<boolean> {
  const [updated] = await dbOrTx.update(adminAuthEmailOutbox).set({
    status: args.reason === "bounce" ? "bounced" : "complained",
    suppressedAt: sql`now()`,
  }).where(and(
    eq(adminAuthEmailOutbox.providerMessageId, args.providerMessageId),
    eq(adminAuthEmailOutbox.status, "sent"),
  )).returning();
  return Boolean(updated);
}

export function recordAdminAuthEmailSuppression(args: { providerMessageId: string; reason: "bounce" | "complaint" }): Promise<boolean> {
  return recordAdminAuthEmailSuppressionIn(db, args);
}

/** Best-effort latency polish; the scheduled outbox job remains the guarantee. */
export function nudgeAdminAuthEmailOutbox(waitUntil: (promise: Promise<unknown>) => void): void {
  const drain = dispatchAdminAuthEmailOutbox(10).catch((error: unknown) => {
    log({ level: "warn", msg: `admin auth outbox nudge failed: ${outboxErrorMessage(error)}`, requestId: "-", feature: "auth" });
  });
  try {
    waitUntil(drain);
  } catch {
    // No Cloudflare execution context in tests/next dev; the promise is
    // already running and the scheduled job recovers it if the process ends.
  }
}
