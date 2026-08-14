export type { CommLogFilters } from "./server/queries";
export { listLog } from "./server/queries";
export { commsKeys } from "./hooks/keys";
export { dispatchOutbox } from "./server/dispatcher";
export { renderTemplate, renderTemplateContent, validateTemplateBody } from "./server/render";
export { seedDefaultTemplates } from "./server/templates";
export { prepareInvite } from "./server/invites";
// The %15 scan owns every reminder/assignment enqueue; domain code never does.
export type { ReminderStats } from "./server/reminders";
export { scanReminders, sendReminderNow, sendRemindersNow } from "./server/reminders";
// M50 — review reminders: outstanding assignments only, and only while the
// round's window is open.
export type { ReviewReminderTarget } from "./server/review-reminders";
export {
  listOutstandingReviewers,
  listOutstandingReviewersIn,
  sendReviewReminders,
  sendReviewRemindersIn,
} from "./server/review-reminders";
// Call `nudgeOutbox(ctx.waitUntil)` right after a user-facing enqueue commits.
export { nudgeOutbox } from "./server/triggers";
// P3-EMAIL — Resend bounce/complaint webhook: signature verification +
// payload parsing (server/webhook.ts) and the suppression write it drives
// (server/suppression.ts). Consumed by src/app/api/webhooks/resend/route.ts.
export { parseResendWebhookEvent, verifyResendWebhookSignature } from "./server/webhook";
export { recordSuppression, recordSuppressionIn } from "./server/suppression";
// M46 — suppression list admin UI (list + reinstate).
export type { SuppressionRow } from "./server/suppression";
export { suppressionRowSchema, listSuppressions, listSuppressionsIn, removeSuppression, removeSuppressionIn } from "./server/suppression";
// M46 — per-domain deliverability visibility, aggregated from communication_logs.
export type { DomainDeliverabilityRow } from "./schemas";
export { domainDeliverabilityRowSchema } from "./schemas";
export { getDeliverabilityByDomain, getDeliverabilityByDomainIn } from "./server/deliverability";
// M46 — bulk segmented sends: resolves a simple filter into the contactIds
// M51's unchanged composeBulkSpeakerEmail flow (above) already accepts.
export { resolveSpeakerSegment, resolveSpeakerSegmentIn } from "./server/segments";
export { buildFeed, buildInvite, googleCalendarUrl, icsUid, outlookCalendarUrl } from "./ics";
export type { IcsEvent } from "./ics";
// M37 — comms admin UI: template editor, reminder-rule toggles, comms log/detail.
export type { EmailTemplateRow, OpenAssignmentRow, ReminderRuleRow, RetryFailedCommunicationsResult, TemplateSaveInput, CommLogDetailWithFlag } from "./server/admin-mutations";
export {
  emailTemplateRowSchema,
  templateSaveInputSchema,
  reminderRuleRowSchema,
  reminderRulesInputSchema,
  openAssignmentRowSchema,
  commLogDetailWithFlagSchema,
  retryFailedCommunicationsInputSchema,
  retryFailedCommunicationsResultSchema,
  listTemplates,
  saveTemplate,
  listReminderRules,
  saveReminderRules,
  getLogDetail,
  retryFailedCommunications,
  listOpenAssignmentsForContact,
} from "./server/admin-mutations";
export { canRetryCommunication, MAX_COMMUNICATION_RETRY_BATCH } from "./schemas";
// M51 — personalized bulk speaker email, through the ordinary outbox.
export { composeBulkSpeakerEmail, composeBulkSpeakerEmailIn } from "./server/speaker-bulk";
