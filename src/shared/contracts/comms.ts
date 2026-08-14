import { z } from "zod";
import { commStatusSchema, templateKeySchema, type TemplateKey } from "./enums";
import { commLogIdSchema, contactIdSchema, sessionIdSchema, submissionIdSchema, taskIdSchema } from "./ids";

/**
 * One organizer-confirmed targeted reminder. `attemptId` is optional while
 * older clients roll forward; new clients retain it across an ambiguous
 * response so a retry identifies the same durable outbox row.
 */
export const sendReminderNowInputSchema = z.object({
  taskId: taskIdSchema,
  contactId: contactIdSchema,
  submissionId: submissionIdSchema.nullable().default(null),
  attemptId: z.uuid().optional(),
});
export type SendReminderNowInput = z.infer<typeof sendReminderNowInputSchema>;
export const sendReminderNowResultSchema = z.object({
  enqueued: z.boolean(),
  /** Present when a stable-attempt replay recovered an existing outbox row. */
  attemptStatus: commStatusSchema.optional(),
});
export type SendReminderNowResult = z.infer<typeof sendReminderNowResultSchema>;

/**
 * One coordinate in an organizer bulk-reminder batch. A batch attempt id is
 * shared by every target, while the outbox idempotency key also includes these
 * coordinates, giving each assignment one durable attempt of its own.
 */
export const bulkReminderTargetSchema = z.object({
  taskId: taskIdSchema,
  contactId: contactIdSchema,
  submissionId: submissionIdSchema.nullable(),
});
export type BulkReminderTarget = z.infer<typeof bulkReminderTargetSchema>;

export const bulkReminderTargetResultSchema = bulkReminderTargetSchema.extend({
  enqueued: z.boolean(),
  /** Missing means the assignment was already complete or no longer exists. */
  attemptStatus: commStatusSchema.optional(),
});
export type BulkReminderTargetResult = z.infer<typeof bulkReminderTargetResultSchema>;

export const bulkReminderResultSchema = z.object({
  enqueued: z.int().nonnegative(),
  total: z.int().nonnegative(),
  results: z.array(bulkReminderTargetResultSchema).max(200),
}).superRefine((value, context) => {
  if (value.total !== value.results.length) {
    context.addIssue({ code: "custom", path: ["total"], message: "Total must match target results" });
  }
  if (value.enqueued !== value.results.filter((result) => result.enqueued).length) {
    context.addIssue({ code: "custom", path: ["enqueued"], message: "Enqueued must match target results" });
  }
  const keys = value.results.map((result) => `${result.taskId}:${result.contactId}:${result.submissionId ?? "-"}`);
  if (new Set(keys).size !== keys.length) {
    context.addIssue({ code: "custom", path: ["results"], message: "Target results must be unique" });
  }
});
export type BulkReminderResult = z.infer<typeof bulkReminderResultSchema>;

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
/**
 * M42 admin auth mail. `action_url` is the one-shot reset/verification link,
 * `expires_in` is an already-formatted human string ("1 hour") because the
 * renderer never does arithmetic — the same rule `reviewVars` follows.
 */
const adminAuthVars = z.object({
  name: z.string(),
  action_url: z.url(),
  expires_in: z.string(),
});
const adminAuthCommonVars = {
  event: commonVars.event,
  speaker: commonVars.speaker,
  unsubscribe: commonVars.unsubscribe,
};
/**
 * M44 team invitations. `action_url` is the one-shot join link. New messages
 * carry it in the product outbox's encrypted payload so provider retries reuse
 * one token; `buildContext` retains the render-time mint only for legacy
 * event-scoped rows. `expires_at` is an already-formatted human string because
 * the renderer never does arithmetic, the same rule `adminAuthVars.expires_in`
 * follows.
 */
const organizationInviteVars = z.object({
  organization_name: z.string(),
  inviter_name: z.string(),
  role: z.string(),
  action_url: z.url(),
  expires_at: z.string(),
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
  // M42 — admin/organizer auth mail (Better Auth password reset and email
  // verification), delivered through the same outbox as everything else.
  //
  // `portal` is deliberately absent: the recipient is signing in to the *admin*
  // app, and minting a 30-day speaker-portal magic link for them would hand an
  // organizer a second, longer-lived credential they never asked for
  // (`buildContext` skips the mint for these two keys for the same reason).
  admin_password_reset: z.object({ ...adminAuthCommonVars, admin: adminAuthVars }),
  admin_email_verification: z.object({ ...adminAuthCommonVars, admin: adminAuthVars }),
  // M44 — team invitations. Product delivery no longer borrows an event, but
  // legacy event-scoped rows still use this variable contract. `portal` is
  // absent: the recipient is joining the admin app, not the speaker portal.
  organization_invited: z.object({ ...adminAuthCommonVars, invite: organizationInviteVars }),
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
  // M42 — admin password reset and email verification are account/security
  // mail the person just asked for by name, exactly the carve-out
  // `portal_login` documents above. An organizer who unsubscribed from event
  // mail must still be able to recover their own login.
  "admin_password_reset",
  "admin_email_verification",
]);
export function isTransactionalTemplate(key: TemplateKey): boolean {
  return TRANSACTIONAL_TEMPLATE_KEYS.has(key);
}
