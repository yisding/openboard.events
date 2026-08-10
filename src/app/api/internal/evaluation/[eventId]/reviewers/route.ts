import { NextRequest } from "next/server";
import { z } from "zod";
import { adminAuth, createEventReviewer, reviewerInviteSchema } from "@/features/auth";
import { listEventMembers } from "@/features/submissions";
import { eventIdSchema } from "@/shared/contracts";
import { nudgeOutbox } from "@/features/comms";
import { defineHandler } from "@/shared/server/handler";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export const dynamic = "force-dynamic";

/**
 * Reviewer provisioning. Organizer-only, because adding an account to an event
 * is a membership decision; the account it creates gets the *lowest* role, so an
 * invited reviewer can reach their queue and nothing else.
 */
const invite = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: reviewerInviteSchema,
  handler: async ({ eventId, input }) => {
    const result = await createEventReviewer(eventIdSchema.parse(eventId), input);
    try {
      const ctx = getCloudflareContext().ctx;
      nudgeOutbox(ctx.waitUntil.bind(ctx));
    } catch {
      // No Cloudflare context (tests, `next dev`): the %1 outbox cron is the
      // guarantee, and a nudge that cannot run is a non-event.
    }
    return result;
  },
});

/** The event's members, so the plans page can offer them as reviewers. */
const list = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: z.object({}).loose(),
  handler: async ({ eventId }) => ({ members: await listEventMembers(eventIdSchema.parse(eventId)) }),
});

export async function GET(request: NextRequest, route: { params: Promise<{ eventId: string }> }): Promise<Response> {
  return list(request, route);
}

export async function POST(request: NextRequest, route: { params: Promise<{ eventId: string }> }): Promise<Response> {
  return invite(request, route);
}
