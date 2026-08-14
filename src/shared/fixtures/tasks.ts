import { taskAssignmentDtoSchema, taskDtoSchema } from "@/shared/contracts";

export const TASK_FIXTURE = taskDtoSchema.parse({
  id: "00000000-0000-4000-8000-000000000701",
  name: "Upload slides",
  descriptionHtml: "<p>Upload a PDF backup.</p>",
  targetType: "submission",
  completionMode: "file_request",
  formId: null,
  fileRequestId: "00000000-0000-4000-8000-000000000702",
  dueAt: "2026-09-10T06:59:59.999Z",
  isActive: true,
  createdAt: "2026-08-08T18:00:00.000Z",
  updatedAt: "2026-08-08T18:00:00.000Z",
});

export const TASK_ASSIGNMENT_FIXTURE = taskAssignmentDtoSchema.parse({
  taskId: TASK_FIXTURE.id,
  contactId: "00000000-0000-4000-8000-000000000401",
  submissionId: "00000000-0000-4000-8000-000000000501",
  dueAt: TASK_FIXTURE.dueAt,
  completed: false,
  completedAt: null,
  completedVia: null,
  overdue: true,
});
