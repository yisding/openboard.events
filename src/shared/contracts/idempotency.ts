import type { ContactId, EventId, OrganizationInvitationId, PlanId, SessionId, SubmissionId, TaskId, TokenId, UserId } from "./ids";

export const idem = {
  received: (eventId: EventId, submissionId: SubmissionId) => `${eventId}:received:${submissionId}`,
  decision: (eventId: EventId, submissionId: SubmissionId, notifyRevision: number) => `${eventId}:decision:${submissionId}:${notifyRevision}`,
  taskAssigned: (eventId: EventId, taskId: TaskId, contactId: ContactId, submissionId: SubmissionId | null) => `${eventId}:task_assigned:${taskId}:${contactId}:${submissionId ?? "-"}`,
  taskReminder: (eventId: EventId, taskId: TaskId, contactId: ContactId, submissionId: SubmissionId | null, offsetDays: number) => `${eventId}:task_reminder:${taskId}:${contactId}:${submissionId ?? "-"}:${offsetDays}`,
  taskReminderManual: (eventId: EventId, taskId: TaskId, contactId: ContactId, submissionId: SubmissionId | null, minuteBucket: number) => `${eventId}:task_reminder:${taskId}:${contactId}:${submissionId ?? "-"}:manual:${minuteBucket}`,
  scheduled: (eventId: EventId, sessionId: SessionId, contactId: ContactId, scheduleRevision: number) => `${eventId}:sched:${sessionId}:${contactId}:${scheduleRevision}`,
  portalLogin: (eventId: EventId, contactId: ContactId, tokenId: TokenId) => `${eventId}:portal_login:${contactId}:${tokenId}`,
  // M50. One key per reviewer per round per reminder cycle: a second click in
  // the same cycle collapses onto the same row, while the next cycle is a new
  // nudge. The cycle number is the caller's, so a scheduled ladder and a manual
  // "remind everyone" button cannot collide by accident.
  reviewReminder: (eventId: EventId, planId: PlanId, reviewerUserId: UserId, cycle: number) =>
    `${eventId}:review_reminder:${planId}:${reviewerUserId}:${cycle}`,
  reviewerInvited: (eventId: EventId, userId: UserId) => `${eventId}:reviewer_invited:${userId}`,
  // M51. `sendId` is one durable caller-generated value per exact approved
  // bulk compose, so the same organizer send fans out to one row per recipient
  // across server-sized batches, event groups, reloads, and retries. A retried
  // request collapses onto the rows already queued rather than duplicating
  // them. `speaker_bulk_messages` (drizzle/0008) is keyed by this same
  // string, which is how `buildContext` finds the one recipient's rendered
  // content for a given outbox row.
  speakerBulk: (eventId: EventId, contactId: ContactId, sendId: string) => `${eventId}:speaker_bulk:${contactId}:${sendId}`,
  // M42. `linkId` is one server-generated value per issued reset/verification
  // link, and it is also the last AAD component the sealed payload is bound to
  // — `buildContext` recovers it from this key, the same trick `portalLogin`
  // uses for its token id. A second "email me a link" click is a new link and
  // therefore a new row, so an older link cannot be resurrected from the
  // outbox.
  adminAuthLink: (eventId: EventId, templateKey: "admin_password_reset" | "admin_email_verification", userId: UserId, linkId: string) =>
    `${eventId}:${templateKey}:${userId}:${linkId}`,
  // M44. `eventId` is the organization's routing event (`homeEventId` in
  // `features/organizations/server/invitations.ts`, the same "oldest
  // membership" trick `adminAuthLink` above uses one scope down), never the
  // organization id itself — the outbox row it stamps is always addressed
  // through an event and a contact. `sendId` is one fresh value per "invite" /
  // "resend" click, so a resend enqueues a new row instead of colliding with
  // (and silently no-op'ing against) the first one on `idempotency_key`'s
  // unique index.
  organizationInvited: (eventId: EventId, invitationId: OrganizationInvitationId, sendId: string) =>
    `${eventId}:organization_invited:${invitationId}:${sendId}`,
} as const;

// Assignments are lazy view rows with no PK — keys are composed from the
// natural key, never from a nonexistent assignmentId. Decision mail goes to
// the submitter (primary) contact only; co-speakers learn via the portal.
