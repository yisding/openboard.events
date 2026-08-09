import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { communicationLogs, emailTemplates } from "@/db/schema";
import type { JobStats } from "@/shared/contracts";
import { getEnv, type RuntimeEnv } from "@/shared/lib/env";
import { isAppError } from "@/shared/lib/errors";
import { buildContext, SkipEmail, type OutboxRow } from "./context";
import { renderTemplateContent } from "./render";
import { sendViaResend, type EmailMessage } from "./resend";

export type OutboxStats = JobStats & { claimed: number; sent: number; skipped: number; failed: number; retried: number };
type Sender = (message: EmailMessage) => Promise<string>;

function emptyStats(): OutboxStats {
  return { claimed: 0, sent: 0, skipped: 0, failed: 0, retried: 0 };
}

async function claimRows(dbOrTx: DbOrTx, requestedBudget: number): Promise<OutboxRow[]> {
  const budget = Number.isFinite(requestedBudget) ? Math.min(Math.max(Math.trunc(requestedBudget), 1), 50) : 50;
  const candidates = dbOrTx.select({ id: communicationLogs.id }).from(communicationLogs).where(and(
    eq(communicationLogs.status, "queued"),
    lte(communicationLogs.nextAttemptAt, sql`now()`),
    or(isNull(communicationLogs.lockedUntil), lt(communicationLogs.lockedUntil, sql`now()`)),
  )).orderBy(asc(communicationLogs.createdAt), asc(communicationLogs.id)).limit(budget).for("update", { skipLocked: true });
  return dbOrTx.update(communicationLogs).set({
    lockedUntil: sql`now() + interval '3 minutes'`,
    attempts: sql`${communicationLogs.attempts} + 1`,
  }).where(inArray(communicationLogs.id, candidates)).returning();
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1_000);
}

function redactCredentials(value: string): string {
  return value
    .replace(/([?&](?:amp;)?token=)[^"'&\s<]+/giu, "$1[redacted]")
    .replace(/(\/cal\/)[^/"'&\s<]+/giu, "$1[redacted]");
}

function persistedHtml(row: OutboxRow, html: string, env: RuntimeEnv): string {
  if (row.templateKey === "portal_login" && !(env.APP_ENV !== "production" && env.EMAIL_MODE === "log" && env.EMAIL_FALLBACK_UI === "1")) {
    return redactCredentials(html).replace(/\b\d{6}\b/gu, "[redacted]");
  }
  return env.APP_ENV === "production" && env.EMAIL_MODE === "send" ? redactCredentials(html) : html;
}

async function markSkipped(dbOrTx: DbOrTx, row: OutboxRow, reason: string): Promise<void> {
  await dbOrTx.update(communicationLogs).set({
    status: "skipped",
    error: reason,
    lockedUntil: null,
    secretPayloadCiphertext: null,
  }).where(eq(communicationLogs.id, row.id));
}

function isTerminalFailure(row: OutboxRow, error: unknown): boolean {
  if (row.attempts >= 6) return true;
  if (isAppError(error) && error.code === "TEMPLATE_VAR_MISSING") return true;
  if (row.templateKey === "portal_login" && isAppError(error) && error.code === "VALIDATION") return true;
  const message = errorMessage(error);
  return message.includes("email template was not found") || message.includes("email sending is not configured");
}

async function markFailure(dbOrTx: DbOrTx, row: OutboxRow, error: unknown): Promise<"failed" | "retried"> {
  const terminal = isTerminalFailure(row, error);
  const delayMinutes = Math.min(2 ** row.attempts, 60);
  await dbOrTx.update(communicationLogs).set({
    status: terminal ? "failed" : "queued",
    error: errorMessage(error),
    lockedUntil: null,
    ...(terminal ? { secretPayloadCiphertext: null } : { nextAttemptAt: sql`now() + ${delayMinutes} * interval '1 minute'` }),
  }).where(eq(communicationLogs.id, row.id));
  return terminal ? "failed" : "retried";
}

async function processRow(dbOrTx: DbOrTx, row: OutboxRow, env: RuntimeEnv, sender: Sender): Promise<"sent" | "skipped"> {
  const context = await buildContext(row, dbOrTx, env);
  const [template] = await dbOrTx.select({ subject: emailTemplates.subject, bodyHtml: emailTemplates.bodyHtml, enabled: emailTemplates.enabled })
    .from(emailTemplates).where(and(eq(emailTemplates.eventId, row.eventId), eq(emailTemplates.key, row.templateKey))).limit(1);
  if (!template) throw new Error("email template was not found");
  if (!template.enabled) {
    await markSkipped(dbOrTx, row, "template disabled");
    return "skipped";
  }
  const subjectTemplate = context.templateOverride?.subject ?? template.subject;
  const bodyTemplate = context.templateOverride?.bodyHtml ?? template.bodyHtml;
  const rendered = renderTemplateContent(row.templateKey, subjectTemplate, bodyTemplate, context.vars, {
    ...(context.logoUrl ? { logoUrl: context.logoUrl } : {}),
    unsubscribeUrl: context.unsubscribeUrl,
  });
  const storedHtml = persistedHtml(row, rendered.html, env);
  await dbOrTx.update(communicationLogs).set({ subjectRendered: rendered.subject, bodyRenderedHtml: storedHtml })
    .where(eq(communicationLogs.id, row.id));

  let providerMessageId = "log-mode";
  if (env.EMAIL_MODE === "send") {
    if (!env.RESEND_API_KEY || !env.EMAIL_FROM) throw new Error("email sending is not configured");
    providerMessageId = await sender({
      apiKey: env.RESEND_API_KEY,
      from: env.EMAIL_FROM,
      to: context.recipientEmail,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      idempotencyKey: row.idempotencyKey,
    });
  }
  await dbOrTx.update(communicationLogs).set({
    status: "sent",
    providerMessageId,
    sentAt: sql`now()`,
    error: null,
    lockedUntil: null,
    secretPayloadCiphertext: null,
  }).where(eq(communicationLogs.id, row.id));
  return "sent";
}

export async function dispatchOutboxIn(dbOrTx: DbOrTx, budget = 50, options?: { env?: RuntimeEnv; sender?: Sender }): Promise<OutboxStats> {
  const env = options?.env ?? getEnv();
  const sender = options?.sender ?? ((message: EmailMessage) => sendViaResend(message));
  const rows = await claimRows(dbOrTx, budget);
  const stats = emptyStats();
  stats.claimed = rows.length;
  for (const row of rows) {
    try {
      const outcome = await processRow(dbOrTx, row, env, sender);
      stats[outcome] += 1;
    } catch (error) {
      if (error instanceof SkipEmail) {
        await markSkipped(dbOrTx, row, error.message);
        stats.skipped += 1;
        continue;
      }
      const outcome = await markFailure(dbOrTx, row, error);
      stats[outcome] += 1;
    }
  }
  return stats;
}

export async function dispatchOutbox(budget = 50): Promise<JobStats> {
  return dispatchOutboxIn(db, budget);
}
