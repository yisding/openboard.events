import { z } from "zod";
import { submissionStatusSchema, tagIdSchema, trackIdSchema } from "@/shared/contracts";

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
