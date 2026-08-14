import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextRequest } from "next/server";
import { adminAuth } from "@/features/auth";
import { nudgeOutbox, sendReminderNow } from "@/features/comms";
import { eventIdSchema, sendReminderNowInputSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

/**
 * The organizer's "Send reminder now" (step 7): enqueues through the same
 * idempotent `sendReminderNow` the reminder scan itself calls, then nudges the
 * outbox so it lands in seconds instead of waiting for the %1 cron tick. No
 * inline sending here or anywhere in this route — `sb-web`'s dispatcher is the
 * only Resend caller.
 */
const send = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: sendReminderNowInputSchema,
  handler: async ({ eventId, input }) => {
    const result = await sendReminderNow(eventIdSchema.parse(eventId), input.taskId, input.contactId, input.submissionId, input.attemptId);
    if (result.enqueued) {
      try {
        const ctx = getCloudflareContext().ctx;
        nudgeOutbox(ctx.waitUntil.bind(ctx));
      } catch {
        // No Worker context (tests, `next dev`) — the %1 cron still drains it.
      }
    }
    return result;
  },
});

export async function POST(request: NextRequest, route: { params: Promise<{ eventId: string }> }): Promise<Response> {
  return send(request, route);
}
