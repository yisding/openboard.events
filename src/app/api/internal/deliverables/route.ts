import type { NextRequest } from "next/server";
import { db } from "@/db/client";
import { listDeliverablesIn, type DeliverableFilters } from "@/features/portal/deliverables/server/queries";
import { deliverableFiltersSchema } from "@/features/portal/deliverables/server/filters";
import { getEventTimezoneIn, tasksAdminAuth } from "@/features/portal/tasks-admin/server/queries";
import { dueRangeFilters } from "@/features/portal/deliverables";
import { eventIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

const listInput = deliverableFiltersSchema;

/**
 * The central Files view's list read (M52). Date-only filters are resolved
 * against the event's own timezone — the same `endOfDayInTz` discipline
 * tasks-admin's own `dueAt` write path uses (analysis trap #9) — rather than
 * a naive `new Date(dateString)` that would be off by up to a day.
 */
const list = defineHandler({
  auth: tasksAdminAuth(),
  input: listInput,
  handler: async ({ eventId, input }) => {
    const scopedEventId = eventIdSchema.parse(eventId);
    const timezone = input.dueOnOrAfter || input.dueOnOrBefore ? await getEventTimezoneIn(db, scopedEventId) : null;
    const filters: DeliverableFilters = {
      ...(input.taskId ? { taskId: input.taskId } : {}),
      ...(input.fileRequestId ? { fileRequestId: input.fileRequestId } : {}),
      ...(input.contactId ? { contactId: input.contactId } : {}),
      ...(input.state ? { state: input.state } : {}),
      ...(input.hasUpload !== undefined ? { hasUpload: input.hasUpload === "true" } : {}),
      ...(input.search ? { search: input.search } : {}),
      ...(timezone ? dueRangeFilters(input, timezone) : {}),
    };
    return listDeliverablesIn(db, scopedEventId, filters);
  },
});

export function GET(request: NextRequest): Promise<Response> {
  return list(request);
}
