import { NextRequest } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/features/auth";
import { listReviewQueue } from "@/features/submissions";
import { eventIdSchema, planIdSchema, userIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

/**
 * What this reviewer still has to score. Scoped to the session's own user id, so
 * the same URL returns a different — and correct — list for every reviewer, and
 * an organizer who is not on the round gets an empty one rather than everything.
 */
const queue = defineHandler({
  auth: adminAuth({ role: "reviewer" }),
  input: z.object({ planId: planIdSchema.optional() }),
  handler: async ({ eventId, session, input }) => listReviewQueue(
    eventIdSchema.parse(eventId),
    userIdSchema.parse(session?.actorId),
    input.planId ?? null,
  ),
});

export async function GET(request: NextRequest, route: { params: Promise<{ eventId: string }> }): Promise<Response> {
  return queue(request, route);
}
