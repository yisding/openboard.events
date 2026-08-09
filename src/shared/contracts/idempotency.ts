import type { ContactId, EventId, SessionId, SubmissionId, TaskId, TokenId } from "./ids";

export const idem = {
  received: (eventId: EventId, submissionId: SubmissionId) => `${eventId}:received:${submissionId}`,
  decision: (eventId: EventId, submissionId: SubmissionId, notifyRevision: number) => `${eventId}:decision:${submissionId}:${notifyRevision}`,
  taskAssigned: (eventId: EventId, taskId: TaskId, contactId: ContactId, submissionId: SubmissionId | null) => `${eventId}:task_assigned:${taskId}:${contactId}:${submissionId ?? "-"}`,
  taskReminder: (eventId: EventId, taskId: TaskId, contactId: ContactId, submissionId: SubmissionId | null, offsetDays: number) => `${eventId}:task_reminder:${taskId}:${contactId}:${submissionId ?? "-"}:${offsetDays}`,
  taskReminderManual: (eventId: EventId, taskId: TaskId, contactId: ContactId, submissionId: SubmissionId | null, minuteBucket: number) => `${eventId}:task_reminder:${taskId}:${contactId}:${submissionId ?? "-"}:manual:${minuteBucket}`,
  scheduled: (eventId: EventId, sessionId: SessionId, contactId: ContactId, scheduleRevision: number) => `${eventId}:sched:${sessionId}:${contactId}:${scheduleRevision}`,
  portalLogin: (eventId: EventId, contactId: ContactId, tokenId: TokenId) => `${eventId}:portal_login:${contactId}:${tokenId}`,
} as const;

// Assignments are lazy view rows with no PK — keys are composed from the
// natural key, never from a nonexistent assignmentId. Decision mail goes to
// the submitter (primary) contact only; co-speakers learn via the portal.
