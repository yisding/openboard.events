import { NextRequest } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/features/auth";
import { BULK_DECISION_LIMIT } from "@/features/submissions/bulk-decision-limit";
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
  handler: async ({ eventId, input, session }) => transitionStatus(
    eventIdSchema.parse(eventId),
    input.ids,
    input.to,
    input.expectedFrom,
    userIdSchema.parse(session?.actorId),
  ),
});

export async function POST(request: NextRequest, route: { params: Promise<{ eventId: string }> }): Promise<Response> {
  return transition(request, route);
}
