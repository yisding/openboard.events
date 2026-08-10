import type { NextRequest } from "next/server";
import { z } from "zod";
import { agendaAuth, deleteSession, saveSession, saveSessionInputSchema } from "@/features/agenda";
import { eventIdSchema, sessionIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";
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
  handler: async ({ eventId, input, params }) => {
    const { sessionId } = paramsSchema.parse(params);
    const session = await saveSession(eventIdSchema.parse(eventId), { ...input, id: sessionId });
    if (session.status === "published" && session.startsAt !== null) nudgeAfterEnqueue();
    return session;
  },
});

const remove = defineHandler({
  auth: agendaAuth(),
  input: z.object({ expectedVersion: z.int().positive() }),
  handler: async ({ eventId, input, params }) => {
    const { sessionId } = paramsSchema.parse(params);
    await deleteSession(eventIdSchema.parse(eventId), sessionId, input.expectedVersion);
    return { deleted: true };
  },
});

export function PATCH(request: NextRequest, route: { params: Promise<{ sessionId: string }> }): Promise<Response> {
  return update(request, route);
}

export function DELETE(request: NextRequest, route: { params: Promise<{ sessionId: string }> }): Promise<Response> {
  return remove(request, route);
}
