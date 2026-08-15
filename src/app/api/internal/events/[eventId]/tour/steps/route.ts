import type { NextRequest } from "next/server";
import { recordTourStep, tourStepRecordSchema } from "@/features/onboarding";
import { adminAuth } from "@/features/auth";
import { eventIdSchema, userIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

/**
 * First Fair — the achievement log. One row per objective the player finished
 * or deliberately skipped, append-only.
 *
 * Deliberately not part of the cursor PATCH: an objective completing and the
 * cursor advancing are different facts with different failure modes, and
 * append-only means the client can fire this without a compare-and-set, a
 * lock, or any retry logic beyond sending it again. A duplicate is a
 * successful no-op (`recorded: false`), never a conflict.
 */
const record = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: tourStepRecordSchema,
  handler: ({ eventId, input, session }) => recordTourStep(
    userIdSchema.parse(session?.actorId),
    eventIdSchema.parse(eventId),
    input,
  ),
});

export function POST(request: NextRequest, route: { params: Promise<{ eventId: string }> }): Promise<Response> {
  return record(request, route);
}
