import { z } from "zod";
import { contactIdSchema, fileRequestIdSchema, taskIdSchema } from "@/shared/contracts";
import { parsePageQuery, type PageQuery } from "@/shared/lib/page-query";
import { endOfDayInTz, zonedTimeToInstant } from "@/shared/lib/time";

const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be a date, YYYY-MM-DD");

/**
 * What the central Files view (M52) can be narrowed by. Shared between the
 * GET route (strict — a bad query is a program's bug, so it 400s) and the
 * page reader below (lenient — a stale bookmark or a hand-edited address bar
 * must not 500 the whole surface), the same split `submissionFiltersSchema`
 * keeps for Abstracts.
 */
export const deliverableFiltersSchema = z.object({
  taskId: taskIdSchema.optional(),
  fileRequestId: fileRequestIdSchema.optional(),
  contactId: contactIdSchema.optional(),
  state: z.enum(["all", "open", "overdue", "completed"]).default("all"),
  dueOnOrAfter: dateOnlySchema.optional(),
  dueOnOrBefore: dateOnlySchema.optional(),
  hasUpload: z.enum(["true", "false"]).optional(),
  search: z.string().trim().max(200).default(""),
});
export type DeliverablePageFilters = z.infer<typeof deliverableFiltersSchema>;

/**
 * The same filters, read for a *page render* rather than an API call. Filters
 * live in the URL — a colleague can be sent a link already narrowed to
 * "overdue, search 'slides'" and the back button behaves — so this has to
 * survive whatever is actually sitting in the address bar: an empty value is
 * absent, and a value that no longer parses (an older build's `state`, say)
 * is dropped by name rather than taking the page down, mirroring
 * `parseSubmissionFiltersForPage`.
 */
export function parseDeliverableFiltersForPage(query: PageQuery): DeliverablePageFilters {
  return parsePageQuery(deliverableFiltersSchema, query);
}

/**
 * Resolve the two date-only filters into the instants the query compares
 * against, in the event's own timezone.
 *
 * Shared by the GET route and the page render because the page had the two
 * filters parsed and then silently dropped them: a URL the route narrows by
 * came back unfiltered when the same address was opened directly. A naive
 * `new Date(dateString)` would be off by up to a day, which is why the
 * conversion goes through the event zone rather than the runtime's.
 */
export function dueRangeFilters(
  filters: { dueOnOrAfter?: string | undefined; dueOnOrBefore?: string | undefined },
  timeZone: string,
): { dueAfter?: string; dueBefore?: string } {
  return {
    ...(filters.dueOnOrAfter ? { dueAfter: startOfDayInTz(filters.dueOnOrAfter, timeZone).toISOString() } : {}),
    ...(filters.dueOnOrBefore ? { dueBefore: endOfDayInTz(filters.dueOnOrBefore, timeZone).toISOString() } : {}),
  };
}

function startOfDayInTz(dateISO: string, timeZone: string): Date {
  const [year, month, day] = dateISO.split("-").map(Number);
  return zonedTimeToInstant(year ?? 1970, month ?? 1, day ?? 1, 0, 0, timeZone);
}
