import { z } from "zod";
import { FIELD_TYPES } from "./enums";

export const answerValueSchema = z.union([z.string(), z.array(z.string()), z.boolean(), z.number(), z.null()]);
export type AnswerValue = z.infer<typeof answerValueSchema>;
export type Answers = Record<string, AnswerValue>;

// Comparison operators require an explicit value; presence operators forbid one.
export const comparisonConditionSchema = z.object({
  sourceFieldId: z.string(),
  operator: z.enum(["eq", "neq", "in", "not_in"]),
  value: answerValueSchema,
});
export const presenceConditionSchema = z.object({
  sourceFieldId: z.string(),
  operator: z.enum(["answered", "empty"]),
});
export const conditionSchema = z.union([comparisonConditionSchema, presenceConditionSchema]);
export type Condition = z.infer<typeof conditionSchema>;

export const formFieldSchema = z.object({
  id: z.string(),
  key: z.string(),
  label: z.string(),
  type: z.enum(FIELD_TYPES),
  required: z.boolean(),
  locked: z.boolean().default(false),
  helpText: z.string().nullable().default(null),
  placeholder: z.string().nullable().default(null),
  maxChars: z.number().nullable().default(null),
  options: z.array(z.object({ id: z.string(), label: z.string() })).default([]),
  visibility: z.object({ match: z.enum(["all", "any"]), conditions: z.array(conditionSchema) }).nullable().default(null),
});
export type FormField = z.infer<typeof formFieldSchema>;

export const formSectionSchema = z.object({
  id: z.string(), key: z.string(), title: z.string(), description: z.string().nullable(), fields: z.array(formFieldSchema),
});
export const formSnapshotSchema = z.object({
  id: z.string(), formId: z.string(), version: z.number(), title: z.string(), sections: z.array(formSectionSchema),
});
export type FormSnapshot = z.infer<typeof formSnapshotSchema>;
