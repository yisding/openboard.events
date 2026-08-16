import type { NextRequest } from "next/server";
import { agendaAuth, applyPlacements } from "@/features/agenda";
import { applyPlacementsInputSchema, eventIdSchema, userIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";
import { revalidatePublicEvent } from "@/features/public/server/revalidate";
import { nudgeAfterEnqueue } from "../../nudge";

export const dynamic = "force-dynamic";

/**
 * M54's Apply step. Every accepted row is preflighted fresh against the
 * current schedule and the current blackouts inside `applyPlacements` before
 * its own `moveSession` call — this route is a thin wire adapter over that,
 * plus the same post-commit outbox nudge every other schedule-mutating route
 * fires when a row lands published-and-timed.
 */
const apply = defineHandler({
  auth: agendaAuth(),
  input: applyPlacementsInputSchema,
  handler: async ({ eventId, input, requestId, session: authSession }) => {
    const scopedEventId = eventIdSchema.parse(eventId);
    const actorUserId = authSession?.actorId ? userIdSchema.parse(authSession.actorId) : null;
    const result = await applyPlacements(scopedEventId, input.accepted, actorUserId);
    let publishedApplied = false;
    let publishedTimed = false;
    for (const outcome of result.outcomes) {
      if (outcome.outcome !== "applied" || outcome.session.status !== "published") continue;
      publishedApplied = true;
      if (outcome.session.startsAt !== null) publishedTimed = true;
    }
    if (publishedTimed) nudgeAfterEnqueue();
    // Apply is a bulk `moveSession`, so it owes the public pages the same
    // invalidation a single move does — once for the whole batch, and on both
    // surfaces. Apply is the operation that *schedules* previously unscheduled
    // sessions, which is precisely the write that changes
    // `published_speakers_v` membership (`starts_at` NULL -> non-NULL), so the
    // speaker pages are the ones least affordable to leave stale here.
    if (publishedApplied) await revalidatePublicEvent(scopedEventId, ["schedule", "speakers"], requestId);
    return result;
  },
});

export function POST(request: NextRequest): Promise<Response> {
  return apply(request);
}
