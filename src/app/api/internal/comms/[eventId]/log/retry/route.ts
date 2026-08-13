import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextRequest } from "next/server";
import { adminAuth } from "@/features/auth";
import {
  nudgeOutbox,
  retryFailedCommunications,
  retryFailedCommunicationsInputSchema,
} from "@/features/comms";
import { eventIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

const retry = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: retryFailedCommunicationsInputSchema,
  handler: async ({ eventId, input }) => {
    const result = await retryFailedCommunications(eventIdSchema.parse(eventId), input.logIds);
    if (result.requeued > 0) {
      try {
        const ctx = getCloudflareContext().ctx;
        nudgeOutbox(ctx.waitUntil.bind(ctx));
      } catch {
        // Tests and next dev have no Worker context; the cron still drains it.
      }
    }
    return result;
  },
});

export async function POST(request: NextRequest, route: { params: Promise<{ eventId: string }> }): Promise<Response> {
  return retry(request, route);
}
