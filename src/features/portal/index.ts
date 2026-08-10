export type { ContactPatch } from "./server/contacts";
export { getOrCreateContact, updateContactFields } from "./server/contacts";
export * from "./task-runtime/index";
export type { PortalContext } from "./server/guards";
export { requirePortalContext } from "./server/guards";
export type { PortalParticipant, PortalStatus, PortalSubmissionDetail, PortalSubmissionRow, PortalTaskSummary } from "./server/queries";
export {
  countMySubmissions,
  countMySubmissionsIn,
  getMySubmission,
  getMySubmissionIn,
  getMyTaskSummary,
  getMyTaskSummaryIn,
  listMySubmissions,
  listMySubmissionsIn,
} from "./server/queries";

// M22 — speaker profile. `updateProfile` is the only writer of these `contacts`
// columns from the portal side; it always goes through `updateContactFields`
// above (resolution #13).
export type { SpeakerProfileDTO } from "./profile/server/queries";
export { getSpeakerProfile, getSpeakerProfileIn } from "./profile/server/queries";
export type { ProfilePatch } from "./profile/server/mutations";
export { profilePatchSchema, updateProfile, updateProfileIn } from "./profile/server/mutations";

// M23 — tasks + file requests admin. Counts and the completion matrix are read
// straight off `task_assignments_v` (resolution #14, the fan-out law) — this
// module never re-derives or backfills an assignment row, only reads and
// (for reopen) deletes a `task_completions` row.
export type { AdminTaskAssignmentDTO, AdminTaskDTO, FileRequestDTO, FormOption, TaskCounts, TaskFilters, TaskTabCounts } from "./tasks-admin/server/queries";
export {
  getEventTimezone,
  getEventTimezoneIn,
  getFileRequest,
  getFileRequestIn,
  getTask,
  getTaskCompletionMatrix,
  getTaskCompletionMatrixIn,
  getTaskIn,
  getTaskTabCounts,
  getTaskTabCountsIn,
  listFileRequests,
  listFileRequestsIn,
  listPortalForms,
  listPortalFormsIn,
  listTasks,
  listTasksIn,
} from "./tasks-admin/server/queries";
export type { SaveFileRequestInput, SaveTaskInput } from "./tasks-admin/server/mutations";
export {
  DEFAULT_ACCEPTED_EXTENSIONS,
  deleteFileRequest,
  deleteFileRequestIn,
  deleteTask,
  deleteTaskIn,
  reopenCompletion,
  reopenCompletionIn,
  saveFileRequest,
  saveFileRequestIn,
  saveFileRequestInputSchema,
  saveTask,
  saveTaskIn,
  saveTaskInputSchema,
} from "./tasks-admin/server/mutations";

// M27 — Speakers admin. Every count comes off the read-model views
// (resolution #14's fan-out rule, consumed not re-derived); both writes go
// through `updateContactFields` above (resolution #13).
export type { ContactFilters, ContactListRow, SpeakerDetailDTO } from "./server/admin-speakers";
export { getAdminSpeaker, getAdminSpeakerIn, getOutstandingTasksView, getOutstandingTasksViewIn, getSpeakerDetail, getSpeakerDetailIn, listContacts, listContactsIn } from "./server/admin-speakers";
export { setConfirmationStatus, setConfirmationStatusIn, updateSpeakerEmail, updateSpeakerEmailIn } from "./server/admin-speakers-mutations";

// M41 — speaker edit-until-close. `getEditableSubmission` is the read gate a
// page uses to decide whether to offer the Edit CTA and what to render once
// there. The write half (`applySubmissionEdit`) is deliberately not exported
// here — it is consumed only by this module's own route, and the one place
// allowed to persist an edit stays M18's `updateSubmissionFromCfp`.
export type { EditableSubmissionSummary, GetEditableSubmissionResult } from "./submissions-edit/server/queries";
export { getEditableSubmission } from "./submissions-edit/server/queries";
