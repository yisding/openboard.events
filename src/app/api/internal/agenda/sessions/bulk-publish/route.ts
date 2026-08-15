import type { NextRequest } from "next/server";
import { z } from "zod";
import { agendaAuth, bulkSetPublished } from "@/features/agenda";
import { eventIdSchema, sessionIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";
import { revalidatePublicEvent } from "@/features/public/server/revalidate";
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
  handler: async ({ eventId, input, requestId }) => {
    const scopedEventId = eventIdSchema.parse(eventId);
    const result = await bulkSetPublished(scopedEventId, input.ids, input.published);
    if (result.emailsQueued > 0) nudgeAfterEnqueue();
    // Publishing is exactly the write an organizer checks on the public page
    // straight afterwards, so it does not wait out the 60s ISR window.
    if (result.changed > 0) await revalidatePublicEvent(scopedEventId, ["schedule", "speakers"], requestId);
    return result;
  },
});

export function POST(request: NextRequest): Promise<Response> {
  return bulkPublish(request);
}
