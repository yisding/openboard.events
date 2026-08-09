import { z } from "zod";
import { completionViaSchema, taskModeSchema, taskTargetSchema } from "./enums";
import { contactIdSchema, submissionIdSchema, taskIdSchema } from "./ids";

export const taskDtoSchema = z.object({
  id: taskIdSchema,
  title: z.string(),
  descriptionHtml: z.string(),
  target: taskTargetSchema,
  mode: taskModeSchema,
  dueAt: z.iso.datetime().nullable(),
  required: z.boolean(),
  active: z.boolean(),
});
export type TaskDTO = z.infer<typeof taskDtoSchema>;

export const taskAssignmentDtoSchema = z.object({
  taskId: taskIdSchema,
  contactId: contactIdSchema,
  submissionId: submissionIdSchema.nullable(),
  completed: z.boolean(),
  completedAt: z.iso.datetime().nullable(),
  completedVia: completionViaSchema.nullable(),
  overdue: z.boolean(),
});
export type TaskAssignmentDTO = z.infer<typeof taskAssignmentDtoSchema>;

export const outstandingTasksRowSchema = z.object({
  contactId: contactIdSchema,
  contactName: z.string(),
  email: z.email(),
  openCount: z.int().nonnegative(),
  overdueCount: z.int().nonnegative(),
  doneCount: z.int().nonnegative(),
});
export type OutstandingTasksRow = z.infer<typeof outstandingTasksRowSchema>;
