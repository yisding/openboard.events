import { z } from "zod";
import { contactIdSchema, fileRequestIdSchema, taskIdSchema } from "@/shared/contracts";

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
export function parseDeliverableFiltersForPage(query: Record<string, string | string[] | undefined>): DeliverablePageFilters {
  const input: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    const scalar = Array.isArray(value) ? value[value.length - 1] : value;
    if (typeof scalar === "string" && scalar !== "") input[key] = scalar;
  }
  const parsed = deliverableFiltersSchema.safeParse(input);
  if (parsed.success) return parsed.data;
  for (const issue of parsed.error.issues) {
    const key = issue.path[0];
    if (typeof key === "string") delete input[key];
  }
  const retried = deliverableFiltersSchema.safeParse(input);
  return retried.success ? retried.data : deliverableFiltersSchema.parse({});
}
