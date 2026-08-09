import type { DbOrTx } from "@/db/client";
import { emailTemplates, reminderRules } from "@/db/schema";
import { TEMPLATE_KEYS, type EventId, type TemplateKey } from "@/shared/contracts";

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
    subject: "You're scheduled: {{session.title}}",
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
