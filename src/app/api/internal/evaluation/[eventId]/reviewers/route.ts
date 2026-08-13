import { NextRequest } from "next/server";
import { z } from "zod";
import { adminAuth, nudgeAdminAuthEmailOutbox } from "@/features/auth";
import { inviteEventReviewer, inviteEventReviewerInputSchema } from "@/features/organizations";
import { listEventMembers } from "@/features/submissions";
import { eventIdSchema, userIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export const dynamic = "force-dynamic";

/**
 * Reviewer invitation. Organizer-only, because event membership is an access
 * decision; the recipient still proves their own mailbox and chooses their own
 * sign-in method before the membership is granted.
 */
const invite = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: inviteEventReviewerInputSchema,
  rateLimit: {
    limit: 20,
    windowMs: 60 * 60 * 1000,
    key: ({ eventId, session }) => `reviewer-invite:${eventId ?? "unknown"}:${session?.actorId ?? "unknown"}`,
  },
  handler: async ({ eventId, input, session }) => {
    const result = await inviteEventReviewer(
      eventIdSchema.parse(eventId),
      userIdSchema.parse(session?.actorId),
      input,
    );
    try {
      const ctx = getCloudflareContext().ctx;
      nudgeAdminAuthEmailOutbox(ctx.waitUntil.bind(ctx));
    } catch {
      // No Cloudflare context (tests, `next dev`): the durable outbox cron is the
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
