import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextRequest } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/features/auth";
import { dispatchOutbox } from "@/features/comms";
import { notifyQueues } from "@/features/submissions";
import { eventIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

/**
 * Finalize both queues and send. Organizer-only: deciding is not a reviewer's
 * job, and this is the one action a speaker sees in their inbox.
 */
const notify = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: z.object({}),
  handler: async ({ eventId }) => {
    const result = await notifyQueues(eventIdSchema.parse(eventId));
    // Latency polish on top of the cron, never a substitute for it: the decision
    // is already committed, so the drain runs after the response through
    // waitUntil rather than making an organizer wait on an outbox backlog that
    // has nothing to do with their click. Failures are swallowed for the same
    // reason — the cron will pick the rows up.
    if (result.emailsQueued > 0) nudge();
    return result;
  },
});

/** Fire-and-forget outside the request path, or not at all if there is no context. */
function nudge(): void {
  const drain = dispatchOutbox().catch(() => undefined);
  try {
    getCloudflareContext().ctx.waitUntil(drain);
  } catch {
    // Outside a Cloudflare context (tests, `next dev`) there is nothing to hand
    // the promise to; the cron remains the guarantee either way.
  }
}

export async function POST(request: NextRequest, route: { params: Promise<{ eventId: string }> }): Promise<Response> {
  return notify(request, route);
}
