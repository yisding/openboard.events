import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { rowsOf } from "@/db/query-result";
import { communicationLogs, contacts, emailTemplates, reminderRules } from "@/db/schema";
import {
  commLogDetailSchema,
  submissionIdSchema,
  taskIdSchema,
  type CommLogDetail,
  type CommLogId,
  type ContactId,
  type EventId,
  type TemplateKey,
} from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { getEnv, type RuntimeEnv } from "@/shared/lib/env";
import { sanitize } from "@/shared/lib/sanitize";
import { validateTemplateBody } from "./render";
import { EVENT_EDITABLE_TEMPLATE_KEYS } from "./templates";
import type {
  CommLogDetailWithFlag,
  EmailTemplateRow,
  RetryFailedCommunicationsResult,
  OpenAssignmentRow,
  ReminderRuleRow,
  TemplateSaveInput,
} from "../schemas";
import {
  canRetryCommunication,
  MAX_COMMUNICATION_RETRY_BATCH,
  NON_RETRYABLE_COMM_TEMPLATE_KEYS,
} from "../schemas";

/**
 * The payload shapes this module reads and writes live in `../schemas` so the
 * M37 hooks can validate against them without pulling the database client into
 * the browser bundle. They are re-exported here (and therefore from the comms
 * barrel) so every existing server-side import keeps working unchanged.
 */
export type {
  CommLogDetailWithFlag,
  EmailTemplateRow,
  OpenAssignmentRow,
  ReminderRuleRow,
  RetryFailedCommunicationsResult,
  TemplateSaveInput,
} from "../schemas";
export {
  commLogDetailWithFlagSchema,
  emailTemplateRowSchema,
  openAssignmentRowSchema,
  reminderRuleRowSchema,
  reminderRulesInputSchema,
  retryFailedCommunicationsInputSchema,
  retryFailedCommunicationsResultSchema,
  templateSaveInputSchema,
} from "../schemas";

function toEmailTemplateRow(row: typeof emailTemplates.$inferSelect): EmailTemplateRow {
  return { key: row.key, subject: row.subject, bodyHtml: row.bodyHtml, enabled: row.enabled, updatedAt: row.updatedAt.toISOString() };
}

/**
 * Event-editable keys in canonical enum order, never database order. Product
 * authentication templates and the team invitation are intentionally absent:
 * they are platform mail, not event configuration.
 */
export async function listTemplatesIn(dbOrTx: DbOrTx, eventId: EventId): Promise<EmailTemplateRow[]> {
  const rows = await dbOrTx.select().from(emailTemplates).where(eq(emailTemplates.eventId, eventId));
  const byKey = new Map(rows.map((row) => [row.key, row]));
  return EVENT_EDITABLE_TEMPLATE_KEYS.map((key) => {
    const row = byKey.get(key);
    if (!row) throw new AppError("INTERNAL", `Template "${key}" is missing for this event — seedDefaultTemplates did not run`);
    return toEmailTemplateRow(row);
  });
}

export async function listTemplates(eventId: EventId): Promise<EmailTemplateRow[]> {
  return listTemplatesIn(db, eventId);
}

/**
 * Unknown-variable validation happens at SAVE time, never at send time (PLAN
 * guardrail, analysis trap #9): a template that renders `undefined` in
 * production is a P0, so a bad token is rejected here — server-side, not just
 * a disabled button — before it ever reaches `email_templates`.
 *
 * `sanitize()` then runs on the body regardless of what the client already did
 * to it (resolution #2): organizer-authored HTML lands in judges' inboxes, and
 * this is the one write path that HTML must never skip.
 *
 * Optimistic concurrency (R11): `expectedUpdatedAt` must match the stored row
 * or the write matches zero rows and the caller gets 409 `STALE_WRITE`, never a
 * silent overwrite of a colleague's edit.
 */
export async function saveTemplateIn(dbOrTx: DbOrTx, eventId: EventId, key: TemplateKey, input: Omit<TemplateSaveInput, "key">): Promise<EmailTemplateRow> {
  if (!(EVENT_EDITABLE_TEMPLATE_KEYS as readonly TemplateKey[]).includes(key)) {
    throw new AppError("VALIDATION", "Platform templates are not event-editable");
  }
  const validation = validateTemplateBody(key, input.subject, input.bodyHtml);
  if (!validation.ok) {
    throw new AppError(
      "TEMPLATE_VAR_MISSING",
      `Unknown variable ${validation.unknownTokens.map((token) => `{{${token}}}`).join(", ")} — remove it or pick from the list`,
      { unknownTokens: validation.unknownTokens },
    );
  }
  const cleanBody = sanitize(input.bodyHtml);
  const expected = new Date(input.expectedUpdatedAt);
  if (Number.isNaN(expected.getTime())) throw new AppError("VALIDATION", "expectedUpdatedAt must be an ISO timestamp");
  const [updated] = await dbOrTx.update(emailTemplates)
    .set({ subject: input.subject, bodyHtml: cleanBody, enabled: input.enabled, updatedAt: new Date() })
    .where(and(
      eq(emailTemplates.eventId, eventId),
      eq(emailTemplates.key, key),
      // `updatedAt` carries Postgres microsecond precision, but `expected` is a JS
      // Date#toISOString() round trip (millisecond only), so compare truncated on
      // both sides — matching the resource_pages CAS pattern.
      sql`date_trunc('milliseconds', ${emailTemplates.updatedAt}) = date_trunc('milliseconds', ${expected.toISOString()}::timestamptz)`,
    ))
    .returning();
  if (!updated) throw new AppError("STALE_WRITE", "This template changed since you loaded it. Reload and try again.");
  return toEmailTemplateRow(updated);
}

export async function saveTemplate(eventId: EventId, key: TemplateKey, input: Omit<TemplateSaveInput, "key">): Promise<EmailTemplateRow> {
  return saveTemplateIn(db, eventId, key, input);
}

export async function listReminderRulesIn(dbOrTx: DbOrTx, eventId: EventId): Promise<ReminderRuleRow[]> {
  return dbOrTx.select({ id: reminderRules.id, offsetDays: reminderRules.offsetDays, enabled: reminderRules.enabled })
    .from(reminderRules).where(eq(reminderRules.eventId, eventId)).orderBy(asc(reminderRules.offsetDays));
}

export async function listReminderRules(eventId: EventId): Promise<ReminderRuleRow[]> {
  return listReminderRulesIn(db, eventId);
}

/**
 * Replaces the whole ladder: upsert every rung the organizer kept (enabled
 * flag only — offsets are the identity), then delete any rung that is no
 * longer in the set. Not one of the 8 audited `withTx` functions (resolution
 * #4), so this is two single-statement writes, not a transaction — an
 * organizer reloading mid-save sees an intermediate state for a heartbeat, not
 * a torn one that outlives the request.
 */
export async function saveReminderRulesIn(dbOrTx: DbOrTx, eventId: EventId, rules: { offsetDays: number; enabled: boolean }[]): Promise<void> {
  const deduped = new Map(rules.map((rule) => [rule.offsetDays, rule.enabled]));
  const values = [...deduped.entries()].map(([offsetDays, enabled]) => ({ eventId, offsetDays, enabled }));
  if (values.length > 0) {
    await dbOrTx.insert(reminderRules).values(values)
      .onConflictDoUpdate({
        target: [reminderRules.eventId, reminderRules.offsetDays],
        set: { enabled: sql`excluded.enabled`, updatedAt: new Date() },
      });
  }
  const keep = [...deduped.keys()];
  await dbOrTx.delete(reminderRules).where(
    keep.length > 0
      ? and(eq(reminderRules.eventId, eventId), notInArray(reminderRules.offsetDays, keep))
      : eq(reminderRules.eventId, eventId),
  );
}

export async function saveReminderRules(eventId: EventId, rules: { offsetDays: number; enabled: boolean }[]): Promise<void> {
  await saveReminderRulesIn(db, eventId, rules);
}

function isPreviewFallbackMode(env: RuntimeEnv = getEnv()): boolean {
  return env.APP_ENV !== "production" && env.EMAIL_MODE === "log" && env.EMAIL_FALLBACK_UI === "1";
}

/**
 * The audit/trust surface (step 6): `body_rendered_html` is rendered through
 * `<RichTextView>` client-side, never here — this only reads the row M34's
 * dispatcher already redacted at storage time. There is nothing left for this
 * query to redact; `previewFallback` merely tells the sheet whether a
 * dev-only, unredacted body is even possible for this deploy.
 */
export async function getLogDetailIn(dbOrTx: DbOrTx, eventId: EventId, logId: CommLogId): Promise<CommLogDetailWithFlag> {
  const [row] = await dbOrTx.select({
    id: communicationLogs.id,
    contactId: communicationLogs.contactId,
    recipientEmail: contacts.email,
    firstName: contacts.firstName,
    lastName: contacts.lastName,
    templateKey: communicationLogs.templateKey,
    status: communicationLogs.status,
    subjectRendered: communicationLogs.subjectRendered,
    bodyRenderedHtml: communicationLogs.bodyRenderedHtml,
    providerMessageId: communicationLogs.providerMessageId,
    error: communicationLogs.error,
    icsUid: communicationLogs.icsUid,
    submissionId: communicationLogs.submissionId,
    sessionId: communicationLogs.sessionId,
    taskId: communicationLogs.taskId,
    idempotencyKey: communicationLogs.idempotencyKey,
    attempts: communicationLogs.attempts,
    createdAt: communicationLogs.createdAt,
    sentAt: communicationLogs.sentAt,
  }).from(communicationLogs)
    .innerJoin(contacts, and(eq(contacts.id, communicationLogs.contactId), eq(contacts.eventId, communicationLogs.eventId)))
    .where(and(eq(communicationLogs.id, logId), eq(communicationLogs.eventId, eventId)))
    .limit(1);
  if (!row) throw new AppError("NOT_FOUND", "That message could not be found");
  const detail: CommLogDetail = commLogDetailSchema.parse({
    ...row,
    recipientName: `${row.firstName} ${row.lastName}`.trim() || row.recipientEmail,
    createdAt: row.createdAt.toISOString(),
    sentAt: row.sentAt?.toISOString() ?? null,
  });
  return { ...detail, previewFallback: isPreviewFallbackMode() };
}

export async function getLogDetail(eventId: EventId, logId: CommLogId): Promise<CommLogDetailWithFlag> {
  return getLogDetailIn(db, eventId, logId);
}

function retryOutcomeCounts(outcomes: RetryFailedCommunicationsResult["outcomes"]): RetryFailedCommunicationsResult {
  return {
    outcomes,
    requeued: outcomes.filter((row) => row.outcome === "requeued").length,
    alreadyQueued: outcomes.filter((row) => row.outcome === "already_queued").length,
    ineligible: outcomes.filter((row) => row.outcome === "ineligible").length,
    notFound: outcomes.filter((row) => row.outcome === "not_found").length,
  };
}

/**
 * Re-opens terminal event-mail failures in place. The existing row and its
 * globally unique idempotency key are retained, so a network ambiguity at the
 * provider cannot become a second logical message. Every UPDATE re-checks the
 * event, failed status, and template eligibility; concurrent retries therefore
 * produce one `requeued` and one `already_queued`, never two rows.
 */
export async function retryFailedCommunicationsIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  logIds: CommLogId[],
): Promise<RetryFailedCommunicationsResult> {
  if (logIds.length < 1 || logIds.length > MAX_COMMUNICATION_RETRY_BATCH || new Set(logIds).size !== logIds.length) {
    throw new AppError("VALIDATION", `Choose between 1 and ${MAX_COMMUNICATION_RETRY_BATCH} distinct failed messages`);
  }

  const scoped = await dbOrTx.select({
    id: communicationLogs.id,
    status: communicationLogs.status,
    templateKey: communicationLogs.templateKey,
  }).from(communicationLogs).where(and(
    eq(communicationLogs.eventId, eventId),
    inArray(communicationLogs.id, logIds),
  ));
  const byId = new Map(scoped.map((row) => [row.id, row]));
  const outcomes: RetryFailedCommunicationsResult["outcomes"] = [];

  for (const logId of logIds) {
    const initial = byId.get(logId);
    if (!initial) {
      outcomes.push({ logId, outcome: "not_found" });
      continue;
    }
    if (initial.status === "queued") {
      outcomes.push({ logId, outcome: "already_queued" });
      continue;
    }
    if (!canRetryCommunication(initial)) {
      outcomes.push({ logId, outcome: "ineligible" });
      continue;
    }

    const [updated] = await dbOrTx.update(communicationLogs).set({
      status: "queued",
      attempts: 0,
      error: null,
      nextAttemptAt: sql`now()`,
      lockedUntil: null,
    }).where(and(
      eq(communicationLogs.id, logId),
      eq(communicationLogs.eventId, eventId),
      eq(communicationLogs.status, "failed"),
      notInArray(communicationLogs.templateKey, [...NON_RETRYABLE_COMM_TEMPLATE_KEYS]),
    )).returning();

    if (updated) {
      outcomes.push({ logId, outcome: "requeued" });
      continue;
    }

    // A competing organizer may have requeued the same row after our initial
    // read. Re-read its event-scoped state so the result reports that race
    // truthfully instead of claiming this request performed the retry.
    const [current] = await dbOrTx.select({ status: communicationLogs.status })
      .from(communicationLogs)
      .where(and(eq(communicationLogs.id, logId), eq(communicationLogs.eventId, eventId)))
      .limit(1);
    outcomes.push({
      logId,
      outcome: current?.status === "queued" ? "already_queued" : current ? "ineligible" : "not_found",
    });
  }

  return retryOutcomeCounts(outcomes);
}

export async function retryFailedCommunications(eventId: EventId, logIds: CommLogId[]): Promise<RetryFailedCommunicationsResult> {
  return retryFailedCommunicationsIn(db, eventId, logIds);
}

type AssignmentRow = { task_id: string; task_name: string; due_at: Date | string | null; submission_id: string | null; submission_code: number | null };

/**
 * What "Send reminder now" (step 7) lets an organizer choose from — this
 * speaker's currently open assignments, straight off `task_assignments_v` so
 * it can never drift from the fan-out law (resolution #14) that decides who
 * has a task in the first place.
 */
export async function listOpenAssignmentsForContactIn(dbOrTx: DbOrTx, eventId: EventId, contactId: ContactId): Promise<OpenAssignmentRow[]> {
  const result = await dbOrTx.execute(sql`
    SELECT a.task_id, t.name AS task_name, a.due_at, a.submission_id, s.code AS submission_code
    FROM task_assignments_v a
    JOIN portal_tasks t ON t.id = a.task_id AND t.event_id = a.event_id
    LEFT JOIN submissions s ON s.id = a.submission_id AND s.event_id = a.event_id
    WHERE a.event_id = ${eventId} AND a.contact_id = ${contactId} AND NOT a.completed
    ORDER BY a.due_at ASC NULLS LAST, t.sort_order, t.name
  `);
  return rowsOf<AssignmentRow>(result).map((row) => ({
    taskId: taskIdSchema.parse(row.task_id),
    taskName: row.task_name,
    dueAt: row.due_at ? new Date(row.due_at).toISOString() : null,
    submissionId: row.submission_id ? submissionIdSchema.parse(row.submission_id) : null,
    submissionCode: row.submission_code === null ? null : `SESS-${row.submission_code}`,
  }));
}

export async function listOpenAssignmentsForContact(eventId: EventId, contactId: ContactId): Promise<OpenAssignmentRow[]> {
  return listOpenAssignmentsForContactIn(db, eventId, contactId);
}
