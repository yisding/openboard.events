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
/**
 * M50 review operations. Reviewers work in the admin app, not the speaker
 * portal, so the actionable link is `review.queue_url`; `outstanding` and
 * `closes_at` are already-formatted strings because the renderer never does
 * arithmetic or timezone work.
 */
const reviewVars = z.object({
  round: z.string(),
  queue_url: z.url(),
  outstanding: z.string(),
  closes_at: z.string(),
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
  reviewer_invited: z.object({ ...commonVars, review: reviewVars }),
  review_reminder: z.object({ ...commonVars, review: reviewVars }),
  // M51 — the personalized bulk speaker email. Subject/body are always an
  // organizer-typed override (`speaker_bulk_messages`, looked up by
  // idempotency key in `buildContext`), so the merge surface is exactly the
  // fields every other template already exposes — no submission/task/session
  // context, because a bulk send is never scoped to one of those.
  speaker_bulk_message: z.object({ ...commonVars }),
} as const satisfies Record<TemplateKey, z.ZodType>;

export type TemplateVarsByKey = {
  [Key in TemplateKey]: z.infer<(typeof TEMPLATE_VAR_SCHEMAS)[Key]>;
};
export type TemplateVars<Key extends TemplateKey = TemplateKey> = TemplateVarsByKey[Key];

/**
 * P3-EMAIL: which `TemplateKey`s are "essential"/transactional — exempt from
 * `contacts.unsubscribed_at` and from carrying a `List-Unsubscribe` header.
 * Decision mail (`submission_accepted`/`submission_declined`) and schedule
 * mail (`schedule_assigned`/`schedule_changed`) keep the pre-existing
 * behaviour the roadmap calls out by name: they have never honored the
 * unsubscribe and continue not to. `portal_login` is included here too —
 * beyond the roadmap's literal "decision/schedule" wording — because it is
 * authentication the contact triggers themselves at the moment of send (an
 * OTP/magic link they just requested by typing their email into the login
 * form); CAN-SPAM makes the same carve-out for account/security mail, and
 * without it an unsubscribed contact could never sign back in to manage
 * anything, including their own subscription state. Every other key is
 * "non-essential": `buildContext` (comms/server/context.ts) skips the send
 * outright when the contact is unsubscribed, and `dispatcher.ts` attaches
 * `List-Unsubscribe`/`List-Unsubscribe-Post` when it does send.
 */
export const TRANSACTIONAL_TEMPLATE_KEYS: ReadonlySet<TemplateKey> = new Set<TemplateKey>([
  "submission_accepted",
  "submission_declined",
  "schedule_assigned",
  "schedule_changed",
  "portal_login",
]);
export function isTransactionalTemplate(key: TemplateKey): boolean {
  return TRANSACTIONAL_TEMPLATE_KEYS.has(key);
}
