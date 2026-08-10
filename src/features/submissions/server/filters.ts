import { z } from "zod";
import { LIMITS, formatIdSchema, submissionStatusSchema, tagIdSchema, trackIdSchema } from "@/shared/contracts";

/**
 * What the Abstracts table can be narrowed by. Parsed rather than trusted: these
 * arrive from a query string, and every one of them reaches SQL.
 *
 * `status: "all"` is a real value rather than an absent one, because the tab bar
 * has an All tab and "no filter" and "the All tab" must mean the same thing.
 */
export const submissionFiltersSchema = z.object({
  status: z.union([submissionStatusSchema, z.literal("all")]).default("all"),
  search: z.string().trim().max(200).default(""),
  trackId: trackIdSchema.nullable().default(null),
  tagId: tagIdSchema.nullable().default(null),
  page: z.int().positive().default(1),
  pageSize: z.int().positive().max(200).default(25),
  sort: z.enum([
    "newest",
    "oldest",
    "code",
    "code_desc",
    "title",
    "title_desc",
    "rating",
    "rating_asc",
  ]).default("newest"),
});
export type SubmissionFilters = z.infer<typeof submissionFiltersSchema>;

/**
 * What an organizer may change from the Abstracts drawer. Status is deliberately
 * absent: a decision goes through `transitionStatus`, which is guarded by the
 * status the organizer was looking at, and letting a field save move a row
 * between queues would route around that guard.
 *
 * Every key is optional and `undefined` means "leave it alone" — a patch is a
 * patch, not a whole row, so a drawer that has not loaded a field cannot blank
 * it. `null` is a real value: it clears the column.
 */
export const submissionFieldPatchSchema = z.object({
  title: z.string().trim().min(1).max(LIMITS.TITLE).optional(),
  descriptionHtml: z.string().max(100_000).nullable().optional(),
  trackId: trackIdSchema.nullable().optional(),
  formatId: formatIdSchema.nullable().optional(),
  level: z.string().trim().max(120).nullable().optional(),
  language: z.string().trim().max(120).nullable().optional(),
  capacity: z.int().nonnegative().max(1_000_000).nullable().optional(),
  startsAt: z.coerce.date().nullable().optional(),
  endsAt: z.coerce.date().nullable().optional(),
  clientSessionId: z.string().trim().max(255).nullable().optional(),
  tagIds: z.array(tagIdSchema).max(50).optional(),
}).refine(
  (patch) => !(patch.startsAt && patch.endsAt) || patch.endsAt.getTime() >= patch.startsAt.getTime(),
  { path: ["endsAt"], message: "A session cannot end before it starts" },
);
export type SubmissionFieldPatch = z.infer<typeof submissionFieldPatchSchema>;
