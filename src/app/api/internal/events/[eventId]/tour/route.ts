import type { NextRequest } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/features/auth";
import { advanceTourCursor, getTourState, tourCursorPatchSchema } from "@/features/onboarding";
import { eventIdSchema, userIdSchema } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { defineHandler } from "@/shared/server/handler";

/**
 * First Fair — the guided tour's cursor and its world snapshot.
 *
 * `GET` is the endpoint an armed "do it yourself" step polls to ask *"has the
 * world reached the objective yet?"*. It answers from one indexed statement,
 * which is what lets cross-tab, cross-device, post-refresh and
 * alternate-route completion all work without the tour knowing anything about
 * the features it is teaching.
 *
 * The rate limit is sized for that poll — armed-only, 2 s backing off to a
 * 10 s ceiling, paused while the tab is hidden — with enough headroom for a
 * player who reloads a few times, and no headroom for a poll that has become
 * a load generator.
 *
 * Organizer-only and event-scoped: a reviewer never sees the tour at all, and
 * `adminAuth` resolves the event from the URL rather than trusting a body.
 */
const read = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: z.object({}).loose(),
  rateLimit: {
    limit: 400,
    windowMs: 5 * 60 * 1000,
    key: ({ eventId }) => `tour-state:${eventId ?? "unknown"}`,
  },
  handler: async ({ eventId, session }) => {
    const state = await getTourState(eventIdSchema.parse(eventId), userIdSchema.parse(session?.actorId));
    if (!state) throw new AppError("NOT_FOUND", "This event has no guided tour");
    return state;
  },
});

/**
 * Moves the cursor, and arms or releases the current step in the same write.
 * `expectedStepId` is a compare-and-set, so two tabs cannot both advance and a
 * replayed advance lands once.
 */
const advance = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: tourCursorPatchSchema,
  handler: ({ eventId, input, session }) => advanceTourCursor(
    userIdSchema.parse(session?.actorId),
    eventIdSchema.parse(eventId),
    input,
  ),
});

export function GET(request: NextRequest, route: { params: Promise<{ eventId: string }> }): Promise<Response> {
  return read(request, route);
}

export function PATCH(request: NextRequest, route: { params: Promise<{ eventId: string }> }): Promise<Response> {
  return advance(request, route);
}
