import type { NextRequest } from "next/server";
import { z } from "zod";
import { agendaAuth, bulkSetPublished } from "@/features/agenda";
import { eventIdSchema, sessionIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";
import { nudgeAfterEnqueue } from "../../nudge";

export const dynamic = "force-dynamic";

/**
 * The List view's bulk bar. Returns how many rows actually changed and how many
 * emails that queued, so the toast can say "8 published, 14 speakers notified"
 * instead of echoing the selection back at the organizer.
 */
const bulkPublish = defineHandler({
  auth: agendaAuth(),
  input: z.object({
    ids: z.array(sessionIdSchema).min(1).max(200),
    published: z.boolean(),
  }),
  handler: async ({ eventId, input }) => {
    const result = await bulkSetPublished(eventIdSchema.parse(eventId), input.ids, input.published);
    if (result.emailsQueued > 0) nudgeAfterEnqueue();
    return result;
  },
});

export function POST(request: NextRequest): Promise<Response> {
  return bulkPublish(request);
}
