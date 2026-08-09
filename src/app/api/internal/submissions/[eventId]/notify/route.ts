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
    // Best effort, failures swallowed: this is latency polish on top of the cron
    // so a decision email lands in about a second rather than at cron latency.
    // M36's nudgeOutbox does not exist yet, so the dispatcher is called directly;
    // it is idempotent, and a failure here must never fail the decision that has
    // already been committed.
    if (result.emailsQueued > 0) await dispatchOutbox().catch(() => undefined);
    return result;
  },
});

export async function POST(request: NextRequest, route: { params: Promise<{ eventId: string }> }): Promise<Response> {
  return notify(request, route);
}
