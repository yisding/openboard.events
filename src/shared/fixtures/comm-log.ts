import { commLogRowSchema } from "@/shared/contracts";

export const COMM_LOG_FIXTURE = commLogRowSchema.parse({
  id: "00000000-0000-4000-8000-000000000801",
  eventId: "00000000-0000-4000-8000-000000000001",
  contactId: "00000000-0000-4000-8000-000000000401",
  templateKey: "submission_received",
  recipient: "speaker@example.com",
  subject: "We received your proposal",
  status: "sent",
  attempts: 1,
  sentAt: "2026-08-08T18:01:00.000Z",
  createdAt: "2026-08-08T18:00:00.000Z",
});
