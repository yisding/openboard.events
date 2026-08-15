import { NextRequest } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/features/auth";
import { BULK_DECISION_LIMIT } from "@/features/submissions/bulk-decision-limit";
import { revalidatePublicEvent } from "@/features/public/server/revalidate";
import { transitionStatus } from "@/features/submissions";
import { eventIdSchema, submissionIdSchema, submissionStatusSchema, userIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

/**
 * Bulk status change. Returns changed and stale together so the table can
 * invalidate its rows and its tab counts in one go, and tell the organizer
 * "n updated, m unchanged" rather than silently dropping the difference.
 */
const transition = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: z.object({
    ids: z.array(submissionIdSchema).min(1).max(BULK_DECISION_LIMIT),
    to: submissionStatusSchema,
    expectedFrom: z.union([submissionStatusSchema, z.array(submissionStatusSchema).min(1)]),
  }),
  handler: async ({ eventId, input, session, requestId }) => {
    const scopedEventId = eventIdSchema.parse(eventId);
    const result = await transitionStatus(
      scopedEventId,
      input.ids,
      input.to,
      input.expectedFrom,
      userIdSchema.parse(session?.actorId),
    );
    // Only an `accepted` submission keeps its promoted session on the public
    // views, so reversing a decision takes that session and its speaker off
    // the public site — refresh it now rather than after the ISR window.
    if (result.changed.length > 0) await revalidatePublicEvent(scopedEventId, ["schedule", "speakers"], requestId);
    return result;
  },
});

export async function POST(request: NextRequest, route: { params: Promise<{ eventId: string }> }): Promise<Response> {
  return transition(request, route);
}
