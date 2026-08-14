import type { NextRequest } from "next/server";
import { z } from "zod";
import { agendaAuth, listSessionContentRevisions, restoreSessionContent } from "@/features/agenda";
import { eventIdSchema, sessionIdSchema, userIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";
import { revalidatePublicEvent } from "@/features/public/server/revalidate";

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
  handler: async ({ eventId, params, input, requestId, session: authSession }) => {
    const { sessionId } = paramsSchema.parse(params);
    const scopedEventId = eventIdSchema.parse(eventId);
    const actorUserId = authSession?.actorId ? userIdSchema.parse(authSession.actorId) : null;
    const session = await restoreSessionContent(scopedEventId, sessionId, input.revisionId, actorUserId);
    // A restore rewrites the title and description the public agenda renders,
    // so a published session's pages are asked back like any other content edit
    // — including the speaker pages, which print the session title beside each
    // speaker, exactly as the sibling save handler does.
    if (session.status === "published") await revalidatePublicEvent(scopedEventId, ["schedule", "speakers"], requestId);
    return session;
  },
});

export function GET(request: NextRequest, route: { params: Promise<{ sessionId: string }> }): Promise<Response> {
  return list(request, route);
}

export function POST(request: NextRequest, route: { params: Promise<{ sessionId: string }> }): Promise<Response> {
  return restore(request, route);
}
