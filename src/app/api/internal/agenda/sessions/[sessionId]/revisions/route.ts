import type { NextRequest } from "next/server";
import { z } from "zod";
import { agendaAuth, listSessionContentRevisions, restoreSessionContent } from "@/features/agenda";
import { eventIdSchema, sessionIdSchema, userIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({ sessionId: sessionIdSchema });

/** M52 — a session's attributed title/description history, newest first. */
const list = defineHandler({
  auth: agendaAuth({ role: "reviewer" }),
  input: z.object({}),
  handler: async ({ eventId, params }) => {
    const { sessionId } = paramsSchema.parse(params);
    return listSessionContentRevisions(eventIdSchema.parse(eventId), sessionId);
  },
});

/** Restore an earlier revision as the session's current content, as a new revision. */
const restore = defineHandler({
  auth: agendaAuth(),
  input: z.object({ revisionId: z.uuid() }),
  handler: async ({ eventId, params, input, session: authSession }) => {
    const { sessionId } = paramsSchema.parse(params);
    const actorUserId = authSession?.actorId ? userIdSchema.parse(authSession.actorId) : null;
    return restoreSessionContent(eventIdSchema.parse(eventId), sessionId, input.revisionId, actorUserId);
  },
});

export function GET(request: NextRequest, route: { params: Promise<{ sessionId: string }> }): Promise<Response> {
  return list(request, route);
}

export function POST(request: NextRequest, route: { params: Promise<{ sessionId: string }> }): Promise<Response> {
  return restore(request, route);
}
