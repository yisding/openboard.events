import { NextRequest } from "next/server";
import { adminAuth } from "@/features/auth";
import { reviewInputSchema, submitReview } from "@/features/submissions";
import { eventIdSchema, userIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

/**
 * A reviewer's verdict. The reviewer is the session, never the body: taking an
 * id from the request would let anyone score in somebody else's name.
 */
const save = defineHandler({
  auth: adminAuth({ role: "reviewer" }),
  input: reviewInputSchema,
  handler: async ({ eventId, session, input }) => submitReview(
    eventIdSchema.parse(eventId),
    input.planId,
    input.submissionId,
    userIdSchema.parse(session?.actorId),
    { overallScore: input.overallScore, criterionScores: input.criterionScores, comment: input.comment },
  ),
});

export async function POST(request: NextRequest, route: { params: Promise<{ eventId: string }> }): Promise<Response> {
  return save(request, route);
}
