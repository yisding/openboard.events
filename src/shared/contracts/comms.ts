import { z } from "zod";
import { commStatusSchema, templateKeySchema } from "./enums";
import { commLogIdSchema, contactIdSchema, sessionIdSchema, submissionIdSchema, taskIdSchema } from "./ids";

export const commLogRowSchema = z.object({
  id: commLogIdSchema,
  contactId: contactIdSchema.nullable(),
  recipientEmail: z.email(),
  recipientName: z.string(),
  templateKey: templateKeySchema,
  status: commStatusSchema,
  subjectRendered: z.string().nullable(),
  providerMessageId: z.string().nullable(),
  error: z.string().nullable(),
  icsUid: z.string().nullable(),
  submissionId: submissionIdSchema.nullable(),
  sessionId: sessionIdSchema.nullable(),
  taskId: taskIdSchema.nullable(),
  createdAt: z.iso.datetime(),
  sentAt: z.iso.datetime().nullable(),
});
export const commLogDetailSchema = commLogRowSchema.extend({
  bodyRenderedHtml: z.string().nullable(),
  idempotencyKey: z.string(),
  attempts: z.int().nonnegative(),
});
export type CommLogRow = z.infer<typeof commLogRowSchema>;
export type CommLogDetail = z.infer<typeof commLogDetailSchema>;

const commonVars = { event: z.object({ name: z.string(), url: z.url() }), contact: z.object({ firstName: z.string(), email: z.email() }) };
export const TEMPLATE_VAR_SCHEMAS = {
  submission_received: z.object({ ...commonVars, submission: z.object({ title: z.string(), code: z.string() }) }),
  submission_accepted: z.object({ ...commonVars, submission: z.object({ title: z.string(), code: z.string() }), portalUrl: z.url() }),
  submission_declined: z.object({ ...commonVars, submission: z.object({ title: z.string(), code: z.string() }), portalUrl: z.url() }),
  task_assigned: z.object({ ...commonVars, task: z.object({ title: z.string(), dueAt: z.string().nullable() }), portalUrl: z.url() }),
  task_reminder: z.object({ ...commonVars, task: z.object({ title: z.string(), dueAt: z.string().nullable() }), portalUrl: z.url() }),
  schedule_assigned: z.object({ ...commonVars, session: z.object({ title: z.string(), startsAt: z.string(), room: z.string().nullable() }) }),
  schedule_changed: z.object({ ...commonVars, session: z.object({ title: z.string(), startsAt: z.string(), room: z.string().nullable() }) }),
  portal_login: z.object({ ...commonVars, otp: z.string(), magicLink: z.url() }),
} as const;
