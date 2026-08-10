import { NextRequest } from "next/server";
import { adminAuth } from "@/features/auth";
import { recuseAssignment, recusalInputSchema, requestWithPathValues } from "@/features/submissions";
import { eventIdSchema, userIdSchema } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

/**
 * Declaring a conflict of interest.
 *
 * A reviewer may recuse themselves and nobody else: `reviewerUserId` in the body
 * is honoured only for organizers, because "recuse on behalf of" is an
 * organizer's decision and a reviewer naming another user would otherwise be
 * able to empty a colleague's queue.
 */
const recuse = defineHandler({
  auth: adminAuth({ role: "reviewer" }),
  input: recusalInputSchema,
  handler: async ({ eventId, session, input }) => {
    const self = userIdSchema.parse(session?.actorId);
    const isOrganizer = session?.role === "organizer" || session?.role === "owner";
    const target = input.reviewerUserId ?? self;
    if (target !== self && !isOrganizer) {
      throw new AppError("FORBIDDEN", "You can only recuse yourself from a submission");
    }
    await recuseAssignment(eventIdSchema.parse(eventId), input.planId, input.submissionId, target, input.reason);
    return { recused: true };
  },
});

export async function POST(request: NextRequest, route: { params: Promise<{ eventId: string; planId: string }> }): Promise<Response> {
  const { planId } = await route.params;
  return recuse(await requestWithPathValues(request, { planId }), route);
}
