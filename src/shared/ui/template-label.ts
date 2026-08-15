import type { TemplateKey } from "@/shared/contracts";

/**
 * The one user-facing name for every email template, shared by the delivery
 * log, the log detail sheet, the Templates editor and a speaker's timeline —
 * the same map `STATUS_BADGES` is for statuses, and for the same reason.
 *
 * Authored, never derived from the enum: `portal_login` reads "Portal sign-in"
 * because that is what it does, and three surfaces deriving their own label
 * from the key gave the same template three different names, one of them
 * lowercase. Adding a `TEMPLATE_KEYS` entry is a type error here until its name
 * is chosen.
 */
const TEMPLATE_LABELS: Record<TemplateKey, string> = {
  submission_received: "Submission received",
  submission_accepted: "Submission accepted",
  submission_declined: "Submission declined",
  task_assigned: "Task assigned",
  task_reminder: "Task reminder",
  schedule_assigned: "Schedule assigned",
  schedule_changed: "Schedule changed",
  portal_login: "Portal sign-in",
  reviewer_invited: "Reviewer invited",
  review_reminder: "Review reminder",
  speaker_bulk_message: "Message",
  admin_password_reset: "Password reset",
  admin_email_verification: "Email verification",
  organization_invited: "Team invitation",
};

export function templateLabel(key: TemplateKey): string {
  return TEMPLATE_LABELS[key];
}
