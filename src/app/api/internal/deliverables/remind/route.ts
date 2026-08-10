import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { NextRequest } from "next/server";
import { nudgeOutbox } from "@/features/comms";
import { bulkRemind, bulkRemindInputSchema } from "@/features/portal/deliverables/server/mutations";
import { tasksAdminAuth } from "@/features/portal/tasks-admin/server/queries";
import { eventIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

/**
 * The central Files view's bulk bar: "remind" for every selected, still-open
 * row. Enqueues through the same idempotent `sendReminderNow` M37's
 * per-speaker button already calls, then nudges the outbox exactly as that
 * route does — no inline sending here or anywhere but `sb-web`'s dispatcher.
 */
const remind = defineHandler({
  auth: tasksAdminAuth({ role: "organizer" }),
  input: bulkRemindInputSchema,
  handler: async ({ eventId, input }) => {
    const result = await bulkRemind(eventIdSchema.parse(eventId), input);
    if (result.enqueued > 0) {
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

export function POST(request: NextRequest): Promise<Response> {
  return remind(request);
}
