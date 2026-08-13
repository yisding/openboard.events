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
