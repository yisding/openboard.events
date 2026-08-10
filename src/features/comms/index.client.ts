// Client-side comms exports. `<CommsLogTable>` is what M27's speaker detail
// embeds for a per-speaker comms history (`contactId` set); `<CommsAdminPage>`
// is the whole `/events/[eventId]/communications` shell.
export { CommsLogTable } from "./components/comms-log-table";
export { CommsAdminPage, type CommsTab } from "./components/comms-admin-page";
export { SendReminderDialog } from "./components/send-reminder-dialog";
// The payload schemas the M37 hooks validate against — safe in the browser
// because `schemas.ts` never touches the database or the session.
export type {
  CommLogDetailWithFlag,
  EmailTemplateRow,
  OpenAssignmentRow,
  ReminderRuleRow,
  TemplateSaveInput,
} from "./schemas";
export {
  commLogDetailWithFlagSchema,
  emailTemplateRowSchema,
  openAssignmentRowSchema,
  reminderRuleRowSchema,
  reminderRulesInputSchema,
  templateSaveInputSchema,
} from "./schemas";
