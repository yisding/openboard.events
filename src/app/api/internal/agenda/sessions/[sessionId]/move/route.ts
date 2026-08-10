import type { NextRequest } from "next/server";
import { z } from "zod";
import { agendaAuth, moveSession } from "@/features/agenda";
import { eventIdSchema, roomIdSchema, sessionIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";
import { revalidatePublicEvent } from "@/shared/server/revalidate-public";
import { nudgeAfterEnqueue } from "../../../nudge";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({ sessionId: sessionIdSchema });

/**
 * The placement endpoint every drag, every dialog reschedule and every ICS
 * lifecycle test hangs off.
 *
 * `version` is not optional and not advisory: a stale one returns HTTP 409 with
 * a `STALE_WRITE` body and changes nothing, including `schedule_revision`. The
 * fresh conflict list comes back in the same response so the grid repaints from
 * the server's verdict rather than recomputing its own.
 */
const move = defineHandler({
  auth: agendaAuth(),
  input: z.object({
    version: z.int().positive(),
    startsAt: z.iso.datetime().nullable(),
    endsAt: z.iso.datetime().nullable(),
    roomId: roomIdSchema.nullable(),
  }),
  handler: async ({ eventId, input, params, requestId }) => {
    const { sessionId } = paramsSchema.parse(params);
    const scopedEventId = eventIdSchema.parse(eventId);
    const result = await moveSession(scopedEventId, { ...input, id: sessionId });
    if (result.session.status === "published" && result.session.startsAt !== null) nudgeAfterEnqueue();
    // Moving a *published* session is a public change — a new time, a new room,
    // or (with a null time) its disappearance from the agenda — so the public
    // pages are asked back instead of waiting out the 60s ISR window, exactly
    // as the save route does. The check is on the status alone, and drafts are
    // skipped: a day-grid drag of unpublished sessions is the common case and
    // must not pay for an invalidation nobody can see.
    //
    // Both surfaces, not just `schedule`: the speaker pages render each
    // speaker's session list with exactly the start time and room name a move
    // rewrites, and `published_speakers_v` joins on `starts_at IS NOT NULL`, so
    // a move to or from the unscheduled tray adds or removes the speaker from
    // /speakers and /gallery outright.
    if (result.session.status === "published") await revalidatePublicEvent(scopedEventId, ["schedule", "speakers"], requestId);
    return result;
  },
});

export function POST(request: NextRequest, route: { params: Promise<{ sessionId: string }> }): Promise<Response> {
  return move(request, route);
}
