import { NextRequest } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/features/auth";
import {
  getReviewerSubmissionDetail,
  getSubmissionDetail,
  submissionFieldPatchSchema,
  updateSubmissionFields,
} from "@/features/submissions";
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
  // Explicitly open to the reviewer role — `adminAuth` is organizer-only by
  // default, and this is one of the three routes a reviewer's own screen calls.
  auth: adminAuth({ role: "reviewer" }),
  input: z.object({ submissionId: submissionIdSchema, planId: planIdSchema.optional() }),
  handler: async ({ eventId, input, session }) => {
    const event = eventIdSchema.parse(eventId);
    if (session?.role === "reviewer") {
      if (!input.planId) throw new AppError("FORBIDDEN", "A review round is required to open this submission");
      // Authorization *and* blindness are settled inside this call, on the
      // server: the reviewer's DTO is built anonymized where the round says so,
      // so there is no un-anonymized object here for a route to leak by
      // forgetting to redact it.
      return getReviewerSubmissionDetail(event, input.planId, input.submissionId, userIdSchema.parse(session.actorId));
    }
    return getSubmissionDetail(event, input.submissionId);
  },
});

/**
 * The drawer's save. `expectedRowVersion` is what the organizer's copy showed:
 * a save composed against a stale copy is refused with 409 `STALE_WRITE` rather
 * than quietly overwriting whatever a colleague changed in the meantime.
 *
 * The submission id comes from the path, never from the body — `/…/A` may not
 * edit submission B because a request said so.
 */
const update = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: z.object({
    expectedRowVersion: z.int().positive(),
    patch: submissionFieldPatchSchema,
  }),
  handler: async ({ eventId, input, params }) => updateSubmissionFields(
    eventIdSchema.parse(eventId),
    submissionIdSchema.parse(params.submissionId),
    input.patch,
    input.expectedRowVersion,
  ),
});

export async function GET(request: NextRequest, route: { params: Promise<{ eventId: string; submissionId: string }> }): Promise<Response> {
  const { submissionId } = await route.params;
  const url = new URL(request.url);
  url.searchParams.set("submissionId", submissionId);
  return detail(new NextRequest(url, request), route);
}

export async function PATCH(request: NextRequest, route: { params: Promise<{ eventId: string; submissionId: string }> }): Promise<Response> {
  return update(request, route);
}
