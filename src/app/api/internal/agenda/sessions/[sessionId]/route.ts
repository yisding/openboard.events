import type { NextRequest } from "next/server";
import { z } from "zod";
import { agendaAuth, deleteSession, saveSession, saveSessionInputSchema } from "@/features/agenda";
import { eventIdSchema, sessionIdSchema, userIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";
import { revalidatePublicEvent } from "@/shared/server/revalidate-public";
import { nudgeAfterEnqueue } from "../../nudge";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({ sessionId: sessionIdSchema });

/**
 * Edit and delete. Both carry `expectedVersion`: the guarded UPDATE and the
 * guarded DELETE are the only thing standing between two organizers editing the
 * same session and one of them losing their work without being told.
 */
const update = defineHandler({
  auth: agendaAuth(),
  // The route's id wins over any `id` in the body — a body cannot redirect a
  // write at another session.
  input: saveSessionInputSchema,
  handler: async ({ eventId, input, params, requestId, session: authSession }) => {
    const { sessionId } = paramsSchema.parse(params);
    const scopedEventId = eventIdSchema.parse(eventId);
    const actorUserId = authSession?.actorId ? userIdSchema.parse(authSession.actorId) : null;
    const session = await saveSession(scopedEventId, { ...input, id: sessionId }, actorUserId);
    if (session.status === "published" && session.startsAt !== null) nudgeAfterEnqueue();
    // A save that lands on (or leaves) `published` changes the public schedule,
    // so it does not wait out the 60s ISR window.
    await revalidatePublicEvent(scopedEventId, ["schedule", "speakers"], requestId);
    return session;
  },
});

const remove = defineHandler({
  auth: agendaAuth(),
  input: z.object({ expectedVersion: z.int().positive() }),
  handler: async ({ eventId, input, params, requestId }) => {
    const { sessionId } = paramsSchema.parse(params);
    const scopedEventId = eventIdSchema.parse(eventId);
    await deleteSession(scopedEventId, sessionId, input.expectedVersion);
    // A deleted session that was published is still on the public agenda until
    // the ISR entry expires, which is the one case where the stale page shows
    // something that no longer exists at all. The row is gone by now, so its
    // status cannot be re-read — this invalidates unconditionally rather than
    // guess, and a delete is rare enough to afford it.
    await revalidatePublicEvent(scopedEventId, ["schedule", "speakers"], requestId);
    return { deleted: true };
  },
});

export function PATCH(request: NextRequest, route: { params: Promise<{ sessionId: string }> }): Promise<Response> {
  return update(request, route);
}

export function DELETE(request: NextRequest, route: { params: Promise<{ sessionId: string }> }): Promise<Response> {
  return remove(request, route);
}
