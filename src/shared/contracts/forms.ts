import { z } from "zod";
import { CONDITION_OPS, COMMITTED_FIELD_TYPES, FIELD_TYPES, FORM_CONTEXTS } from "./enums";
import {
  fieldIdSchema,
  fileIdSchema,
  formIdSchema,
  formatIdSchema,
  sectionIdSchema,
  tagIdSchema,
  trackIdSchema,
} from "./ids";
import type { FieldId, FormId, SectionId } from "./ids";

export const answerValueSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("s"), v: z.string() }),
  z.object({ t: z.literal("n"), v: z.number() }),
  z.object({ t: z.literal("d"), v: z.iso.date() }),
  z.object({ t: z.literal("opt"), v: z.string() }),
  z.object({ t: z.literal("opts"), v: z.array(z.string()) }),
  z.object({ t: z.literal("file"), v: fileIdSchema }),
]);
export type AnswerValue = z.infer<typeof answerValueSchema>;

export type Answers = Readonly<Partial<Record<FieldId, AnswerValue>>>;

// There is no `contains` op. Multi-select "contains option X" is expressed as
// `in` over option ids. Semantics are specified by src/shared/lib/conditions.test.ts.
export const conditionSchema = z.object({
  sourceFieldId: fieldIdSchema,
  op: z.enum(CONDITION_OPS),
  value: z.union([z.string(), z.array(z.string())]).optional(),
}).superRefine((condition, context) => {
  const requiresValue = condition.op === "eq" || condition.op === "neq" || condition.op === "in" || condition.op === "not_in";
  if (requiresValue && condition.value === undefined) {
    context.addIssue({ code: "custom", path: ["value"], message: `${condition.op} requires a value` });
  }
  if (!requiresValue && condition.value !== undefined) {
    context.addIssue({ code: "custom", path: ["value"], message: `${condition.op} does not accept a value` });
  }
});
export type Condition = z.infer<typeof conditionSchema>;

export const visibilityRuleSchema = z.object({
  match: z.enum(["all", "any"]),
  conditions: z.array(conditionSchema).min(1).max(5),
});
export type VisibilityRule = z.infer<typeof visibilityRuleSchema>;

export const routingRuleSchema = z.object({
  id: z.uuid(),
  sortOrder: z.int().nonnegative(),
  match: z.enum(["all", "any"]),
  conditions: z.array(conditionSchema).min(1).max(5),
  setTrackId: trackIdSchema.optional(),
  addTagIds: z.array(tagIdSchema),
  enabled: z.boolean(),
});
export type RoutingRule = z.infer<typeof routingRuleSchema>;

export const MAPS_TO_TARGETS = [
  "submission.title",
  "submission.description_html",
  "submission.track_id",
  "submission.format_id",
  "submission.level",
  "submission.language",
  "contact.first_name",
  "contact.last_name",
  "contact.email",
  "contact.bio_html",
  "contact.company",
  "contact.job_title",
  "contact.pronouns",
  "contact.headshot_file_id",
  "contact.linkedin_url",
  "contact.twitter_url",
  "contact.website_url",
] as const;
export const mapsToTargetSchema = z.enum(MAPS_TO_TARGETS);
export type MapsToTarget = z.infer<typeof mapsToTargetSchema>;

export const formOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  trackId: trackIdSchema.optional(),
  formatId: formatIdSchema.optional(),
  tagId: tagIdSchema.optional(),
});

export const formFieldSchema = z.object({
  id: fieldIdSchema,
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(FIELD_TYPES),
  required: z.boolean(),
  locked: z.boolean(),
  maxChars: z.int().positive().nullable(),
  helpText: z.string(),
  options: z.array(formOptionSchema),
  visibility: visibilityRuleSchema.nullable(),
  mapsTo: mapsToTargetSchema.nullable(),
});
export type FormField = z.infer<typeof formFieldSchema>;

export const formSectionSchema = z.object({
  id: sectionIdSchema,
  key: z.string().min(1),
  title: z.string(),
  pageHeading: z.string(),
  descriptionHtml: z.string(),
  fields: z.array(formFieldSchema),
});
export type FormSection = z.infer<typeof formSectionSchema>;

export const formSnapshotSchema = z.object({
  formId: formIdSchema,
  version: z.int().positive(),
  context: z.enum(FORM_CONTEXTS),
  sections: z.array(formSectionSchema),
});
export type FormSnapshot = z.infer<typeof formSnapshotSchema>;

export const cleanAnswersSchema = z.array(z.object({
  fieldId: fieldIdSchema,
  participantId: z.string().nullable(),
  value: answerValueSchema,
})).superRefine((answers, context) => {
  const seen = new Set<string>();
  for (const [index, answer] of answers.entries()) {
    const key = JSON.stringify([answer.fieldId, answer.participantId]);
    if (seen.has(key)) {
      context.addIssue({ code: "custom", path: [index], message: "duplicate answer for field and participant" });
    }
    seen.add(key);
  }
}).brand<"CleanAnswers">();
export type CleanAnswers = z.infer<typeof cleanAnswersSchema>;

export type FormAuthoringRows = {
  form: { id: FormId; context: (typeof FORM_CONTEXTS)[number]; version: number };
  sections: Array<{
    id: SectionId;
    key: string;
    title: string;
    pageHeading: string;
    descriptionHtml: string;
    sortOrder: number;
  }>;
  fields: Array<{
    id: FieldId;
    sectionId: SectionId;
    key: string;
    label: string;
    fieldType: (typeof FIELD_TYPES)[number];
    required: boolean;
    locked: boolean;
    maxChars: number | null;
    helpText: string;
    options: Array<z.infer<typeof formOptionSchema>>;
    visibility: VisibilityRule | null;
    mapsTo: MapsToTarget | null;
    sortOrder: number;
    deletedAt: string | null;
  }>;
};

export function isCommittedFieldType(value: string): value is (typeof COMMITTED_FIELD_TYPES)[number] {
  return (COMMITTED_FIELD_TYPES as readonly string[]).includes(value);
}
