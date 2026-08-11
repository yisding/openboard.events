import { NextRequest } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/features/auth";
import { assignReviewers, getPlan, requestWithPathValues, reviewerAssignmentSchema } from "@/features/submissions";
import { eventIdSchema, planIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

/**
 * The round's reviewer set, replaced wholesale — the client sends who should be
 * on it, not a diff, so two organizers editing the same round cannot leave it
 * holding the union of both their intentions.
 */
const replace = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: z.object({
    planId: planIdSchema,
    reviewers: z
      .array(reviewerAssignmentSchema)
      .max(50)
      .refine((reviewers) => new Set(reviewers.map((reviewer) => reviewer.userId)).size === reviewers.length, {
        message: "A reviewer can only be assigned once per evaluation plan",
      }),
  }),
  handler: async ({ eventId, input }) => {
    const event = eventIdSchema.parse(eventId);
    await assignReviewers(event, input.planId, input.reviewers);
    return getPlan(event, input.planId);
  },
});

export async function PUT(request: NextRequest, route: { params: Promise<{ eventId: string; planId: string }> }): Promise<Response> {
  const { planId } = await route.params;
  return replace(await requestWithPathValues(request, { planId }), route);
}
