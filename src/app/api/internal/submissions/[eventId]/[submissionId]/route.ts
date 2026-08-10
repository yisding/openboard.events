import { NextRequest } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/features/auth";
import { assertReviewerCanReadSubmission, getSubmissionDetail } from "@/features/submissions";
import { eventIdSchema, planIdSchema, submissionIdSchema, userIdSchema } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

/**
 * One submission with its answers and the snapshot they were written against.
 * Organizers may open any event submission; a reviewer must name the review
 * round and pass the same assignment/scope check as the queue.
 */
const detail = defineHandler({
  auth: adminAuth(),
  input: z.object({ submissionId: submissionIdSchema, planId: planIdSchema.optional() }),
  handler: async ({ eventId, input, session }) => {
    const event = eventIdSchema.parse(eventId);
    if (session?.role === "reviewer") {
      if (!input.planId) throw new AppError("FORBIDDEN", "A review round is required to open this submission");
      await assertReviewerCanReadSubmission(event, input.planId, input.submissionId, userIdSchema.parse(session.actorId));
    }
    return getSubmissionDetail(event, input.submissionId);
  },
});

export async function GET(request: NextRequest, route: { params: Promise<{ eventId: string; submissionId: string }> }): Promise<Response> {
  const { submissionId } = await route.params;
  const url = new URL(request.url);
  url.searchParams.set("submissionId", submissionId);
  return detail(new NextRequest(url, request), route);
}
