import type { NextRequest } from "next/server";
import { z } from "zod";
import { agendaAuth, moveSession } from "@/features/agenda";
import { eventIdSchema, roomIdSchema, sessionIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";
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
  handler: async ({ eventId, input, params }) => {
    const { sessionId } = paramsSchema.parse(params);
    const result = await moveSession(eventIdSchema.parse(eventId), { ...input, id: sessionId });
    if (result.session.status === "published" && result.session.startsAt !== null) nudgeAfterEnqueue();
    return result;
  },
});

export function POST(request: NextRequest, route: { params: Promise<{ sessionId: string }> }): Promise<Response> {
  return move(request, route);
}
