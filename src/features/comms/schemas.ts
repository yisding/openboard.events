/**
 * Client-safe comms shapes. The zod mirrors of the M37 admin payloads live here
 * rather than beside their queries because `server/admin-mutations.ts` reaches
 * the database (and, through `@/features/auth`, `next/headers`) — a hook that
 * imported a schema from the server barrel dragged that whole graph into the
 * browser bundle and failed the build. `server/admin-mutations.ts` re-exports
 * every name below, so the server barrel's surface is unchanged.
 */
import { z } from "zod";
import { commLogDetailSchema, commLogIdSchema, contactIdSchema, submissionIdSchema, suppressionReasonSchema, taskIdSchema, templateKeySchema, type CommLogRow, type TemplateKey } from "@/shared/contracts";

/**
 * Terminal delivery failures clear one-shot payloads in the dispatcher. Those
 * rows cannot be reconstructed safely from the audit log, so the organizer's
 * recovery action is deliberately limited to ordinary event mail.
 */
export const NON_RETRYABLE_COMM_TEMPLATE_KEYS: ReadonlySet<TemplateKey> = new Set([
  "portal_login",
  "admin_password_reset",
  "admin_email_verification",
  "organization_invited",
]);

export function canRetryCommunication(row: Pick<CommLogRow, "status" | "templateKey">): boolean {
  return row.status === "failed" && !NON_RETRYABLE_COMM_TEMPLATE_KEYS.has(row.templateKey);
}

export const MAX_COMMUNICATION_RETRY_BATCH = 50;

export const retryFailedCommunicationsInputSchema = z.object({
  logIds: z.array(commLogIdSchema).min(1).max(MAX_COMMUNICATION_RETRY_BATCH),
}).superRefine(({ logIds }, context) => {
  if (new Set(logIds).size !== logIds.length) {
    context.addIssue({ code: "custom", path: ["logIds"], message: "Select each message only once" });
  }
});

const retryCommunicationOutcomeSchema = z.object({
  logId: commLogIdSchema,
  outcome: z.enum(["requeued", "already_queued", "ineligible", "not_found"]),
});

export const retryFailedCommunicationsResultSchema = z.object({
  outcomes: z.array(retryCommunicationOutcomeSchema),
  requeued: z.number().int().nonnegative(),
  alreadyQueued: z.number().int().nonnegative(),
  ineligible: z.number().int().nonnegative(),
  notFound: z.number().int().nonnegative(),
});
export type RetryFailedCommunicationsResult = z.infer<typeof retryFailedCommunicationsResultSchema>;

/**
 * The organizer-facing mirror of one `email_templates` row. This UI **updates**
 * rows only — `seedDefaultTemplates` ([M34](./server/templates.ts)) owns the 8
 * inserts, and the admin module never adds or removes a key.
 */
export type EmailTemplateRow = {
  key: TemplateKey;
  subject: string;
  bodyHtml: string;
  enabled: boolean;
  updatedAt: string;
};

export const emailTemplateRowSchema = z.object({
  key: templateKeySchema,
  subject: z.string(),
  bodyHtml: z.string(),
  enabled: z.boolean(),
  updatedAt: z.iso.datetime(),
});

export const templateSaveInputSchema = z.object({
  key: templateKeySchema,
  subject: z.string().trim().min(1, "Subject is required").max(300),
  // The organizer's raw editor value. `sanitize()` runs server-side before the
  // UPDATE (resolution #2) — the client-sanitized copy is a preview only, never
  // trusted as the stored value.
  bodyHtml: z.string().max(50_000),
  enabled: z.boolean(),
  expectedUpdatedAt: z.iso.datetime(),
});
export type TemplateSaveInput = z.infer<typeof templateSaveInputSchema>;

export type ReminderRuleRow = { id: string; offsetDays: number; enabled: boolean };

export const reminderRuleRowSchema = z.object({ id: z.string(), offsetDays: z.int(), enabled: z.boolean() });

export const reminderRulesInputSchema = z.object({
  rules: z.array(z.object({
    offsetDays: z.int().min(-90).max(90),
    enabled: z.boolean(),
  })).max(20),
});

export const commLogDetailWithFlagSchema = commLogDetailSchema.extend({
  // The `text/plain` alternative of the stored body, derived by the query from
  // `bodyRenderedHtml` with the same `stripHtml` the dispatcher renders with.
  // Not a column: nothing may make the two disagree.
  bodyRenderedText: z.string().nullable(),
  // Mirrors the dispatcher's own preview-fallback condition (`server/dispatcher.ts`).
  // Production always has `EMAIL_FALLBACK_UI=0` (fail-closed env validation), so
  // this can only be true off a local/preview box in `EMAIL_MODE=log`.
  previewFallback: z.boolean(),
});
export type CommLogDetailWithFlag = z.infer<typeof commLogDetailWithFlagSchema>;

export type OpenAssignmentRow = {
  taskId: z.infer<typeof taskIdSchema>;
  taskName: string;
  dueAt: string | null;
  submissionId: z.infer<typeof submissionIdSchema> | null;
  submissionCode: string | null;
};

export const openAssignmentRowSchema = z.object({
  taskId: taskIdSchema,
  taskName: z.string(),
  dueAt: z.iso.datetime().nullable(),
  submissionId: submissionIdSchema.nullable(),
  submissionCode: z.string().nullable(),
});

// --- M46: suppression list admin UI -----------------------------------

/**
 * One `contact_suppressions` row, joined out to a displayable
 * recipient. Presence in the underlying table means suppressed — see the
 * table's own migration comment — so this row's mere existence in the list
 * is the signal; there is no "active"/"inactive" flag to read.
 */
export type SuppressionRow = {
  contactId: z.infer<typeof contactIdSchema>;
  email: string;
  name: string;
  reason: z.infer<typeof suppressionReasonSchema>;
  suppressedAt: string;
};

export const suppressionRowSchema = z.object({
  contactId: contactIdSchema,
  email: z.email(),
  name: z.string(),
  reason: suppressionReasonSchema,
  suppressedAt: z.iso.datetime(),
});

// --- M46: per-domain deliverability -------------------------------------

/**
 * One row per recipient email domain, aggregated from `communication_logs`
 * for the event. `total` is every attempt regardless of outcome; the six
 * per-status counts sum to it. The two rate fields are percentages
 * (0–100, one decimal) computed against `sent + bounced + complained` — the
 * set of sends that reached a definitive provider outcome — so a domain
 * that is still mostly `queued` does not show a misleadingly low rate.
 */
export type DomainDeliverabilityRow = {
  domain: string;
  total: number;
  queued: number;
  sent: number;
  failed: number;
  skipped: number;
  bounced: number;
  complained: number;
  bounceRatePct: number;
  complaintRatePct: number;
};

export const domainDeliverabilityRowSchema = z.object({
  domain: z.string(),
  total: z.number().int().nonnegative(),
  queued: z.number().int().nonnegative(),
  sent: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  bounced: z.number().int().nonnegative(),
  complained: z.number().int().nonnegative(),
  bounceRatePct: z.number().nonnegative(),
  complaintRatePct: z.number().nonnegative(),
});
