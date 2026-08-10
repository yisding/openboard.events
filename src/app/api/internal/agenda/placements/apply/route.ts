import type { NextRequest } from "next/server";
import { agendaAuth, applyPlacements } from "@/features/agenda";
import { applyPlacementsInputSchema, eventIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";
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
  handler: async ({ eventId, input }) => {
    const result = await applyPlacements(eventIdSchema.parse(eventId), input.accepted);
    if (result.outcomes.some((outcome) => outcome.outcome === "applied" && outcome.session.status === "published" && outcome.session.startsAt !== null)) {
      nudgeAfterEnqueue();
    }
    return result;
  },
});

export function POST(request: NextRequest): Promise<Response> {
  return apply(request);
}
