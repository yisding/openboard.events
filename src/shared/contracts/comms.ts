import { z } from "zod";
import { commStatusSchema, templateKeySchema, type TemplateKey } from "./enums";
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

const commonVars = {
  event: z.object({
    name: z.string(),
    start_date: z.string(),
    location: z.string(),
    timezone: z.string(),
  }),
  speaker: z.object({
    first_name: z.string(),
    last_name: z.string(),
    email: z.email(),
  }),
  portal: z.object({ magic_link: z.url() }),
  unsubscribe: z.object({ url: z.url() }),
};

const submissionVars = z.object({ title: z.string(), code: z.string() });
const taskVars = z.object({ name: z.string(), due_date: z.string() });
const sessionVars = z.object({
  title: z.string(),
  start_time_local: z.string(),
  end_time_local: z.string(),
  timezone: z.string(),
  room: z.string(),
  track: z.string(),
});
const calendarVars = z.object({
  google_url: z.url(),
  outlook_url: z.url(),
  download_url: z.url(),
  buttons_html: z.string(),
});

export const TEMPLATE_VAR_SCHEMAS = {
  submission_received: z.object({ ...commonVars, submission: submissionVars }),
  submission_accepted: z.object({ ...commonVars, submission: submissionVars }),
  submission_declined: z.object({ ...commonVars, submission: submissionVars }),
  task_assigned: z.object({ ...commonVars, task: taskVars, tasks: z.object({ outstanding_list: z.string() }) }),
  task_reminder: z.object({ ...commonVars, task: taskVars, tasks: z.object({ outstanding_list: z.string() }) }),
  schedule_assigned: z.object({ ...commonVars, session: sessionVars, calendar: calendarVars }),
  schedule_changed: z.object({ ...commonVars, session: sessionVars, calendar: calendarVars }),
  portal_login: z.object({ ...commonVars, otp: z.object({ code: z.string().regex(/^\d{6}$/u) }) }),
} as const satisfies Record<TemplateKey, z.ZodType>;

export type TemplateVarsByKey = {
  [Key in TemplateKey]: z.infer<(typeof TEMPLATE_VAR_SCHEMAS)[Key]>;
};
export type TemplateVars<Key extends TemplateKey = TemplateKey> = TemplateVarsByKey[Key];
