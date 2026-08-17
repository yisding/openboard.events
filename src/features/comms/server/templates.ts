import type { DbOrTx } from "@/db/client";
import { emailTemplates, reminderRules } from "@/db/schema";
import { TEMPLATE_KEYS, type EventId, type TemplateKey } from "@/shared/contracts";

/**
 * Event organizers can edit event mail. Product authentication mail now uses
 * a platform-level fixed template because it may be sent before an event
 * exists; leaving those keys in the event editor would be a control that
 * no longer affects anything. `organization_invited` joined them in M44:
 * team invitations go out through `adminAuthEmailOutbox`/`admin-mail.ts`,
 * which renders fixed copy and never reads `email_templates`, so editing the
 * row — or switching it off — would not change a single invitation sent.
 */
export const EVENT_EDITABLE_TEMPLATE_KEYS: TemplateKey[] = TEMPLATE_KEYS.filter(
  (key) => key !== "admin_password_reset" && key !== "admin_email_verification" && key !== "organization_invited",
);

export const DEFAULT_TEMPLATES: Record<TemplateKey, { subject: string; bodyHtml: string }> = {
  submission_received: {
    subject: "We received your submission — {{submission.title}}",
    bodyHtml: "<p>Thanks for submitting <strong>{{submission.title}}</strong> ({{submission.code}}) to {{event.name}}.</p><p>You can track it in your portal: <a href=\"{{portal.magic_link}}\">Open your speaker portal</a>.</p>",
  },
  submission_accepted: {
    subject: "Your session was accepted for {{event.name}}",
    bodyHtml: "<p>Congratulations! We accepted <strong>{{submission.title}}</strong> for {{event.name}}.</p><p>Review your next steps in the <a href=\"{{portal.magic_link}}\">speaker portal</a>.</p>",
  },
  submission_declined: {
    subject: "An update on your submission to {{event.name}}",
    bodyHtml: "<p>Thank you for submitting <strong>{{submission.title}}</strong> to {{event.name}}.</p><p>We are sorry that we cannot include it in this program.</p>",
  },
  task_assigned: {
    subject: "New task for {{event.name}}: {{task.name}}",
    bodyHtml: "<p>A new task is ready: <strong>{{task.name}}</strong>, due {{task.due_date}}.</p><p><a href=\"{{portal.magic_link}}\">Open your speaker portal</a> to complete it.</p>",
  },
  task_reminder: {
    subject: "Reminder: {{task.name}} is due {{task.due_date}}",
    bodyHtml: "<p>Here are your outstanding tasks:</p>{{tasks.outstanding_list}}<p><a href=\"{{portal.magic_link}}\">Open your speaker portal</a>.</p><p><a href=\"{{unsubscribe.url}}\">Unsubscribe from reminders</a>.</p>",
  },
  schedule_assigned: {
    subject: "You’re scheduled: {{session.title}}",
    bodyHtml: "<p><strong>{{session.title}}</strong> is scheduled for {{session.start_time_local}}–{{session.end_time_local}} {{session.timezone}} in {{session.room}}.</p>{{calendar.buttons_html}}",
  },
  schedule_changed: {
    subject: "Updated time for {{session.title}}",
    bodyHtml: "<p><strong>{{session.title}}</strong> is now scheduled for {{session.start_time_local}}–{{session.end_time_local}} {{session.timezone}} in {{session.room}}.</p><p>Your calendar invite has been updated.</p>{{calendar.buttons_html}}",
  },
  portal_login: {
    subject: "Your sign-in code for {{event.name}}",
    bodyHtml: "<p>Hi {{speaker.first_name}},</p><p>Your sign-in code is <strong>{{otp.code}}</strong>.</p><p>Or use this one-tap link: <a href=\"{{portal.magic_link}}\">Sign in to your portal</a>.</p>",
  },
  // M50. Reviewers work in the admin app, so both of these point at the review
  // queue rather than the speaker portal, and neither carries a credential.
  reviewer_invited: {
    subject: "You’re reviewing for {{event.name}}",
    bodyHtml: "<p>Hi {{speaker.first_name}},</p><p>You have been added as a reviewer for <strong>{{event.name}}</strong> on the round “{{review.round}}”.</p><p><a href=\"{{review.queue_url}}\">Open your review queue</a> to sign in and start scoring.</p>",
  },
  review_reminder: {
    subject: "{{review.outstanding}} still to review for {{event.name}}",
    bodyHtml: "<p>Hi {{speaker.first_name}},</p><p>You have <strong>{{review.outstanding}}</strong> still to score in “{{review.round}}”. The round closes {{review.closes_at}}.</p><p><a href=\"{{review.queue_url}}\">Open your review queue</a>.</p>",
  },
  // M51. This row exists only so `email_templates.enabled` has something to
  // gate and the dispatcher's `SELECT ... FROM email_templates` finds a row —
  // the subject/body it names are never rendered: `composeBulkSpeakerEmailIn`
  // always writes a `speaker_bulk_messages` row and `buildContext` always
  // overrides with it (comms/server/context.ts), the same
  // `templateOverride` mechanism the form-confirmation email already uses.
  speaker_bulk_message: {
    subject: "A message about {{event.name}}",
    bodyHtml: "<p>Hi {{speaker.first_name}},</p><p>(This default is never sent — every send overrides it.)</p>",
  },
  // M42. Admin auth mail: the recipient is an organizer or reviewer signing in
  // to the admin app, so neither of these mentions the speaker portal. Both
  // say plainly what to do if the request was not theirs, because a reset link
  // arriving unasked-for is the one signal a user has that something is wrong.
  admin_password_reset: {
    subject: "Reset your {{event.name}} organizer password",
    bodyHtml: "<p>Hi {{admin.name}},</p><p>Someone asked to reset the password for this account on {{event.name}}.</p><p><a href=\"{{admin.action_url}}\">Choose a new password</a>. The link works once and expires in {{admin.expires_in}}.</p><p>If this was not you, you can ignore this email — your password has not changed.</p>",
  },
  admin_email_verification: {
    subject: "Confirm your email for {{event.name}}",
    bodyHtml: "<p>Hi {{admin.name}},</p><p>Confirm this address to finish setting up your {{event.name}} organizer account.</p><p><a href=\"{{admin.action_url}}\">Confirm your email</a>. The link works once and expires in {{admin.expires_in}}.</p>",
  },
  // M44 — team invitations. `invite.role` is a plain word ("organizer",
  // "reviewer"), not a badge, so it reads fine inline.
  organization_invited: {
    subject: "You’re invited to join {{invite.organization_name}}",
    bodyHtml: "<p>Hi {{speaker.first_name}},</p><p>{{invite.inviter_name}} invited you to join <strong>{{invite.organization_name}}</strong> on Openboard as a {{invite.role}}.</p><p><a href=\"{{invite.action_url}}\">Accept the invitation</a>. The link expires {{invite.expires_at}}.</p><p>If you were not expecting this, you can ignore this email.</p>",
  },
};

export async function seedDefaultTemplates(dbOrTx: DbOrTx, eventId: EventId): Promise<void> {
  await dbOrTx.insert(emailTemplates).values(TEMPLATE_KEYS.map((key) => ({
    eventId,
    key,
    subject: DEFAULT_TEMPLATES[key].subject,
    bodyHtml: DEFAULT_TEMPLATES[key].bodyHtml,
  }))).onConflictDoNothing({ target: [emailTemplates.eventId, emailTemplates.key] });

  await dbOrTx.insert(reminderRules).values([-7, -1, 1].map((offsetDays) => ({ eventId, offsetDays, enabled: true })))
    .onConflictDoNothing({ target: [reminderRules.eventId, reminderRules.offsetDays] });
}
