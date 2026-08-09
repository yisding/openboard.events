import { outstandingTasksRowSchema } from "@/shared/contracts";

export const OUTSTANDING_TASKS_FIXTURE = outstandingTasksRowSchema.parse({
  contactId: "00000000-0000-4000-8000-000000000401",
  contactName: "Ada Lovelace",
  email: "speaker@example.com",
  openCount: 2,
  overdueCount: 1,
  doneCount: 1,
});
