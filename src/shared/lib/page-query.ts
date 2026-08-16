import { z } from "zod";

export type PageQuery = Record<string, string | string[] | undefined>;

/**
 * Parse filters from a page URL without letting one stale or hand-edited value
 * take down the whole server-rendered surface.
 *
 * API handlers should parse their query schemas strictly and return a 400 for
 * invalid input. Page URLs are different: empty values are treated as absent,
 * repeated values use the last entry a browser form would have submitted, and
 * fields named by validation errors fall back to their schema defaults while
 * valid filters remain in place.
 *
 * Page-filter schemas using this helper must accept an empty object so the
 * final fallback can produce their default view.
 */
/**
 * A 1-based page number from a page URL's `?page=`.
 *
 * Not `Number(value)` guarded by `Number.isFinite`: `1.5` and `1e30` are both
 * finite and both positive, and a page number is only ever used as arithmetic
 * on a SQL `OFFSET`, where a fraction is not a rounded page but a hard
 * `invalid input syntax for type bigint` from the database, and an unsafe
 * integer fails `z.number().int()` in the filter schemas that carry one.
 *
 * Schema-driven filters get this from `z.coerce.number().int().positive()` via
 * `parsePageQuery` above. The pages that assemble their filters by hand read it
 * here so both paths agree on what a page number is, and so a hand-edited
 * address bar degrades to the first page like every other bad filter value
 * rather than taking the surface down.
 *
 * The ceiling is what keeps the *offset* safe as well as the page: every caller
 * multiplies by a page size, and a page of `Number.MAX_SAFE_INTEGER` would land
 * an offset outside the safe range, failing `.int()` again one multiplication
 * later. A million pages is past the end of any real dataset here.
 */
export const MAX_PAGE_NUMBER = 1_000_000;

export function pageNumberFrom(value: string | undefined): number {
  const page = Number(value ?? "1");
  return Number.isSafeInteger(page) && page > 0 && page <= MAX_PAGE_NUMBER ? page : 1;
}

export function parsePageQuery<Schema extends z.ZodType>(schema: Schema, query: PageQuery): z.output<Schema> {
  const input: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    const scalar = Array.isArray(value) ? value[value.length - 1] : value;
    if (typeof scalar === "string" && scalar !== "") input[key] = scalar;
  }

  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;

  for (const issue of parsed.error.issues) {
    const key = issue.path[0];
    if (typeof key === "string") delete input[key];
  }

  const retried = schema.safeParse(input);
  return retried.success ? retried.data : schema.parse({});
}
