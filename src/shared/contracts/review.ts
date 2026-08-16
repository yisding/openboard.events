import { z } from "zod";
import { criterionKindSchema } from "./enums";
import { criterionIdSchema } from "./ids";
import { LIMITS } from "./limits";

/**
 * M50 — the typed answer a reviewer gives one criterion.
 *
 * M19 stored a bare number per criterion in `reviews.criterion_scores`. That
 * payload is *evolved in place* rather than replaced by a second answer store:
 * every leaf becomes a discriminated value, so a select option and a free-text
 * note can live next to a number without anything downstream having to guess
 * what a value means from the criterion it happens to hang off.
 *
 * Arithmetic is deliberately a property of the value, not of the caller:
 *   - `numeric` contributes its `value`;
 *   - `select` contributes the chosen option's `score`, and nothing when that
 *     score is `null` (an "N/A" or purely descriptive option);
 *   - `text` never contributes.
 *
 * The text branch carries the same ceiling the textarea enforces. Not `.trim()`
 * — `isValidCriterionValue` already owns the non-empty rule, and trimming here
 * would change what is stored.
 */
export const criterionValueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("numeric"), value: z.number() }),
  z.object({ kind: z.literal("select"), optionId: z.string().min(1) }),
  z.object({ kind: z.literal("text"), value: z.string().max(LIMITS.REVIEW_TEXT) }),
]);
export type CriterionValue = z.infer<typeof criterionValueSchema>;

export const criterionValuesSchema = z.record(criterionIdSchema, criterionValueSchema);
export type CriterionValues = z.infer<typeof criterionValuesSchema>;

/**
 * One choice on a `select` criterion. `score: null` means the option is
 * recorded but never averaged — "Not applicable" must not read as a zero.
 */
export const selectOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().trim().min(1).max(120),
  score: z.number().nullable(),
});
export type SelectOption = z.infer<typeof selectOptionSchema>;

/**
 * What the server needs to know about a criterion to grade a set of values:
 * its kind, its weight in the round's mean, whether it must be answered for the
 * review to count as complete, and the bounds a numeric answer has to sit in
 * (`null` bounds fall back to the plan's own scale).
 */
export const criterionSpecSchema = z.object({
  id: criterionIdSchema,
  kind: criterionKindSchema,
  weight: z.number().positive(),
  required: z.boolean(),
  options: z.array(selectOptionSchema),
  minValue: z.number().nullable(),
  maxValue: z.number().nullable(),
});
export type CriterionSpec = z.infer<typeof criterionSpecSchema>;

/**
 * A reviewer's window into a round. `state` is derived from the plan's
 * half-open `[opensAt, closesAt)` window and its status, and is the single
 * answer to "may this reviewer read, and may they write?" — the UI renders it
 * and the server re-derives it on every write.
 */
export const reviewWindowSchema = z.object({
  opensAt: z.iso.datetime().nullable(),
  closesAt: z.iso.datetime().nullable(),
  state: z.enum(["before_open", "open", "closed"]),
  canRead: z.boolean(),
  canSave: z.boolean(),
});
export type ReviewWindow = z.infer<typeof reviewWindowSchema>;
