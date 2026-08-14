// M52 — the shared deliverable-slot module: file versions and their plaintext
// comment thread, read/written by both the speaker's task detail and the
// organizer's tasks-admin / central Files surfaces.
export type { CommentAuthor } from "./server/deliverable-slot";
export {
  addFileComment,
  addFileCommentIn,
  listFileComments,
  listFileCommentsIn,
  listFileVersions,
  listFileVersionsIn,
} from "./server/deliverable-slot";
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
// columns from the portal side; it always goes through the event-contacts
// feature's field-scoped writer (resolution #13).
export type { SpeakerProfileDTO } from "./profile/server/queries";
export { getSpeakerProfile, getSpeakerProfileIn } from "./profile/server/queries";
export type { ProfilePatch } from "./profile/server/mutations";
export { markAcceptanceSeen, markAcceptanceSeenIn, profilePatchSchema, updateProfile, updateProfileIn } from "./profile/server/mutations";

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
  createFileRequest,
  createFileRequestIn,
  createTask,
  createTaskIn,
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
export type { ContactFilters, ContactListRow, SpeakerDetailDTO, SpeakerFilterCounts, SpeakerOptionRow } from "./server/admin-speakers";
export { getAdminSpeaker, getAdminSpeakerIn, getOutstandingTasksView, getOutstandingTasksViewIn, getSpeakerDetail, getSpeakerDetailIn, getSpeakerFilterCounts, getSpeakerFilterCountsIn, listContacts, listContactsIn, listSpeakerOptions, listSpeakerOptionsIn } from "./server/admin-speakers";
export {
  setConfirmationStatus,
  setConfirmationStatusIn,
  updateSpeakerBio,
  updateSpeakerBioIn,
  updateSpeakerEmail,
  updateSpeakerEmailIn,
  updateSpeakerHeadshot,
  updateSpeakerHeadshotIn,
} from "./server/admin-speakers-mutations";

// M41 — speaker edit-until-close. `getEditableSubmission` is the read gate a
// page uses to decide whether to offer the Edit CTA and what to render once
// there. The write half (`applySubmissionEdit`) is deliberately not exported
// here — it is consumed only by this module's own route, and the one place
// allowed to persist an edit stays M18's `updateSubmissionFromCfp`.
export type { EditableSubmissionSummary, GetEditableSubmissionResult } from "./submissions-edit/server/queries";
export { getEditableSubmission } from "./submissions-edit/server/queries";

// M24 — portal form builder. UI-only: no new server functions of its own,
// just the list/single-page builder wrapping M12's generalized engine
// (context='portal' forms) — see plan/modules/M24-portal-form-builder.md.
export { PortalFormsPage } from "./form-builder/components/portal-forms-page";
export { PortalFormBuilder } from "./form-builder/components/portal-form-builder";

// M51 — standalone speaker roster operations. Reads: logistics fields,
// per-contact logistics values, declared unavailability (the M54 read
// contract) and organizer-visible uploaded assets. Writes go through
// `createSpeakerIn`/`updateSpeakerProfileIn` — both of which call
// the event-contacts identity writers — plus the CSV importer
// and the one-CTE unavailability replace.
export type { SpeakerRosterExtras } from "./server/speaker-roster-queries";
export {
  getSpeakerRosterExtras,
  getSpeakerRosterExtrasIn,
  listLogisticsFields,
  listLogisticsFieldsIn,
  listSpeakerLogisticsValues,
  listSpeakerLogisticsValuesIn,
  listSpeakerUnavailability,
  listSpeakerUnavailabilityIn,
  listSpeakerUploads,
  listSpeakerUploadsIn,
} from "./server/speaker-roster-queries";
export {
  createLogisticsField,
  createLogisticsFieldIn,
  createSpeaker,
  createSpeakerIn,
  deleteLogisticsField,
  deleteLogisticsFieldIn,
  importSpeakersCsv,
  importSpeakersCsvIn,
  replaceSpeakerUnavailability,
  replaceSpeakerUnavailabilityIn,
  updateSpeakerProfile,
  updateSpeakerProfileIn,
} from "./server/speaker-roster-mutations";
