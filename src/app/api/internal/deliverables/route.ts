import type { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/db/client";
import { listDeliverablesIn, type DeliverableFilters } from "@/features/portal/deliverables/server/queries";
import { getEventTimezoneIn, tasksAdminAuth } from "@/features/portal/tasks-admin/server/queries";
import { contactIdSchema, eventIdSchema, fileRequestIdSchema, taskIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";
import { endOfDayInTz, zonedTimeToInstant } from "@/shared/lib/time";

const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be a date, YYYY-MM-DD");

const listInput = z.object({
  taskId: taskIdSchema.optional(),
  fileRequestId: fileRequestIdSchema.optional(),
  contactId: contactIdSchema.optional(),
  state: z.enum(["all", "open", "overdue", "completed"]).optional(),
  dueOnOrAfter: dateOnlySchema.optional(),
  dueOnOrBefore: dateOnlySchema.optional(),
  hasUpload: z.enum(["true", "false"]).optional(),
  search: z.string().max(200).optional(),
});

function startOfDayInTz(dateISO: string, timeZone: string): Date {
  const [year, month, day] = dateISO.split("-").map(Number);
  return zonedTimeToInstant(year ?? 1970, month ?? 1, day ?? 1, 0, 0, timeZone);
}

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
      ...(input.dueOnOrAfter && timezone ? { dueAfter: startOfDayInTz(input.dueOnOrAfter, timezone).toISOString() } : {}),
      ...(input.dueOnOrBefore && timezone ? { dueBefore: endOfDayInTz(input.dueOnOrBefore, timezone).toISOString() } : {}),
    };
    return listDeliverablesIn(db, scopedEventId, filters);
  },
});

export function GET(request: NextRequest): Promise<Response> {
  return list(request);
}
