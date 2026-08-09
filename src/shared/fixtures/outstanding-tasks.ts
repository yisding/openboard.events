import { outstandingTasksRowSchema } from "@/shared/contracts";

export const OUTSTANDING_TASKS_FIXTURE = outstandingTasksRowSchema.parse({
  contactId: "00000000-0000-4000-8000-000000000401",
  name: "Ada Lovelace",
  openCount: 2,
  overdueCount: 1,
  doneCount: 1,
});
