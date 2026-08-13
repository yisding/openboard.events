import { z } from "zod";
import { LIMITS, formatIdSchema, submissionStatusSchema, tagIdSchema, trackIdSchema } from "@/shared/contracts";
import { BULK_DECISION_LIMIT } from "../bulk-decision-limit";

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
  // Coerced, not bare `z.int()`: every caller of this schema parses a *query
  // string* — `defineHandler`'s `queryInput` for GET, and `export.csv` from
  // `searchParams` — so a page size arrives as `"200"`, which a bare integer
  // schema rejects. Without the coercion the two pagination parameters this
  // route advertises are unusable over HTTP: `?pageSize=200` answered 400
  // VALIDATION while the server page, which hand-wrapped them in `Number(…)`,
  // worked. Numbers still parse unchanged, so the server page keeps working.
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(BULK_DECISION_LIMIT).default(25),
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
 * The same filters, read for a *page render* rather than for an API call.
 *
 * A route must reject a bad parameter — `export.csv` and the list endpoint both
 * answer 400, and that is right, because a program sent it. A page is different:
 * its query string is in the address bar, where an organizer edits it, a stale
 * bookmark preserves it and a shared link carries it. `submissionFiltersSchema
 * .parse` inside a server component turns any of those into a 500 error page
 * for the whole Abstracts surface, so `?page=` (an empty value, which coerces
 * to 0) or a `status` from an older build takes the table down instead of
 * ignoring one word.
 *
 * So: empty values are treated as absent, and a value that still will not parse
 * is dropped by name and the rest kept — a mistyped `sort` must not also lose
 * the `status` tab the organizer is standing on.
 */
export function parseSubmissionFiltersForPage(query: Record<string, string | string[] | undefined>): SubmissionFilters {
  const input: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    // A repeated parameter (`?status=a&status=b`) is ambiguous; the last one
    // wins, which is what a browser form would have sent anyway.
    const scalar = Array.isArray(value) ? value[value.length - 1] : value;
    if (typeof scalar === "string" && scalar !== "") input[key] = scalar;
  }
  const parsed = submissionFiltersSchema.safeParse(input);
  if (parsed.success) return parsed.data;
  for (const issue of parsed.error.issues) {
    const key = issue.path[0];
    if (typeof key === "string") delete input[key];
  }
  // Every remaining key already parsed once and each field has a default, so
  // the retry succeeds; the bare defaults are the floor if it somehow does not,
  // because a page that renders the first page of everything is always better
  // than a page that does not render.
  const retried = submissionFiltersSchema.safeParse(input);
  return retried.success ? retried.data : submissionFiltersSchema.parse({});
}

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
