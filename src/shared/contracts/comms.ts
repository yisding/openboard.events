import { z } from "zod";
import { commStatusSchema, templateKeySchema } from "./enums";
import { commLogIdSchema, contactIdSchema, eventIdSchema } from "./ids";

export const commLogRowSchema = z.object({
  id: commLogIdSchema,
  eventId: eventIdSchema,
  contactId: contactIdSchema.nullable(),
  templateKey: templateKeySchema,
  recipient: z.email(),
  subject: z.string().nullable(),
  status: commStatusSchema,
  attempts: z.int().nonnegative(),
  sentAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export const commLogDetailSchema = commLogRowSchema.extend({
  renderedHtml: z.string().nullable(),
  error: z.string().nullable(),
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
