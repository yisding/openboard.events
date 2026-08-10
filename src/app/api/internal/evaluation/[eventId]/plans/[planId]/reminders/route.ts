import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextRequest } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/features/auth";
import { listOutstandingReviewers, nudgeOutbox, sendReviewReminders } from "@/features/comms";
import { requestWithPathValues } from "@/features/submissions";
import { eventIdSchema, planIdSchema, userIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

/**
 * "Remind everyone who still owes me scores."
 *
 * Every row goes through `enqueueEmail`, so the reminder shows up in the
 * communication log like any other message and the dispatcher is still the only
 * thing that talks to Resend. Sending is refused outside the round's window:
 * chasing people about a round that has not opened is noise, and chasing them
 * about one that has closed is worse.
 */
const remind = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: z.object({
    planId: planIdSchema,
    /** `null` (the default) means every reviewer with outstanding work. */
    reviewerUserIds: z.array(userIdSchema).max(50).nullable().default(null),
  }),
  handler: async ({ eventId, input }) => {
    const result = await sendReviewReminders(eventIdSchema.parse(eventId), input.planId, input.reviewerUserIds);
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

/** Who the button would reach, so the organizer sees it before pressing. */
const preview = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: z.object({ planId: planIdSchema }),
  handler: async ({ eventId, input }) => ({
    reviewers: await listOutstandingReviewers(eventIdSchema.parse(eventId), input.planId),
  }),
});

export async function GET(request: NextRequest, route: { params: Promise<{ eventId: string; planId: string }> }): Promise<Response> {
  const { planId } = await route.params;
  const url = new URL(request.url);
  url.searchParams.set("planId", planId);
  return preview(new NextRequest(url, request), route);
}

export async function POST(request: NextRequest, route: { params: Promise<{ eventId: string; planId: string }> }): Promise<Response> {
  const { planId } = await route.params;
  return remind(await requestWithPathValues(request, { planId }), route);
}
