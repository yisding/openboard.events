import { z } from "zod";
import { completionViaSchema, taskModeSchema, taskTargetSchema } from "./enums";
import { contactIdSchema, fileRequestIdSchema, formIdSchema, submissionIdSchema, taskIdSchema } from "./ids";

export const taskDtoSchema = z.object({
  id: taskIdSchema,
  name: z.string(),
  descriptionHtml: z.string(),
  targetType: taskTargetSchema,
  completionMode: taskModeSchema,
  formId: formIdSchema.nullable(),
  fileRequestId: fileRequestIdSchema.nullable(),
  dueAt: z.iso.datetime().nullable(),
  isActive: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type TaskDTO = z.infer<typeof taskDtoSchema>;

export const taskAssignmentDtoSchema = z.object({
  taskId: taskIdSchema,
  contactId: contactIdSchema,
  submissionId: submissionIdSchema.nullable(),
  dueAt: z.iso.datetime().nullable(),
  completed: z.boolean(),
  completedAt: z.iso.datetime().nullable(),
  completedVia: completionViaSchema.nullable(),
  overdue: z.boolean(),
});
export type TaskAssignmentDTO = z.infer<typeof taskAssignmentDtoSchema>;

export const outstandingTasksRowSchema = z.object({
  contactId: contactIdSchema,
  name: z.string(),
  openCount: z.int().nonnegative(),
  overdueCount: z.int().nonnegative(),
  doneCount: z.int().nonnegative(),
});
export type OutstandingTasksRow = z.infer<typeof outstandingTasksRowSchema>;
