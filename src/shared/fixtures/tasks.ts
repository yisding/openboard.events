import { taskDtoSchema } from "@/shared/contracts";

export const TASK_FIXTURE = taskDtoSchema.parse({
  id: "00000000-0000-4000-8000-000000000701",
  title: "Upload slides",
  descriptionHtml: "<p>Upload a PDF backup.</p>",
  target: "submission",
  mode: "file_request",
  dueAt: "2026-09-10T06:59:59.999Z",
  required: true,
  active: true,
});
