/**
 * Client-safe comms shapes. The zod mirrors of the M37 admin payloads live here
 * rather than beside their queries because `server/admin-mutations.ts` reaches
 * the database (and, through `@/features/auth`, `next/headers`) — a hook that
 * imported a schema from the server barrel dragged that whole graph into the
 * browser bundle and failed the build. `server/admin-mutations.ts` re-exports
 * every name below, so the server barrel's surface is unchanged.
 */
import { z } from "zod";
import { commLogDetailSchema, submissionIdSchema, taskIdSchema, templateKeySchema, type TemplateKey } from "@/shared/contracts";

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
