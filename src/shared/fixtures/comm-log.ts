import { commLogDetailSchema, commLogRowSchema } from "@/shared/contracts";

export const COMM_LOG_FIXTURE = commLogRowSchema.parse({
  id: "00000000-0000-4000-8000-000000000801",
  contactId: "00000000-0000-4000-8000-000000000401",
  recipientEmail: "speaker@example.com",
  recipientName: "Ada Lovelace",
  templateKey: "submission_received",
  status: "sent",
  subjectRendered: "We received your submission",
  providerMessageId: "resend-message-1",
  error: null,
  icsUid: null,
  submissionId: "00000000-0000-4000-8000-000000000501",
  sessionId: null,
  taskId: null,
  createdAt: "2026-08-08T18:00:00.000Z",
  sentAt: "2026-08-08T18:01:00.000Z",
});

export const COMM_LOG_DETAIL_FIXTURE = commLogDetailSchema.parse({
  ...COMM_LOG_FIXTURE,
  bodyRenderedHtml: "<p>We received your submission.</p>",
  idempotencyKey: "submission-received:00000000-0000-4000-8000-000000000501",
  attempts: 1,
});
