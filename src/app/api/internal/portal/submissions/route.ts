import type { NextRequest } from "next/server";
import { z } from "zod";
import { portalAuth } from "@/features/auth";
import { listMySubmissions } from "@/features/portal";
import { contactIdSchema, eventIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

/**
 * The speaker's own submissions. The guard resolves the session for the event in
 * the query string, and the query joins through submission_participants, so
 * there is no id here a caller could substitute.
 */
const listMine = defineHandler({
  auth: async (request, _eventId, params) => {
    const eventId = eventIdSchema.parse(new URL(request.url).searchParams.get("eventId"));
    const session = await portalAuth()(request, eventId, params);
    return session ? { ...session, eventId } : null;
  },
  input: z.object({ eventId: eventIdSchema }),
  handler: async ({ input, session }) => ({
    submissions: await listMySubmissions(input.eventId, contactIdSchema.parse(session?.actorId)),
  }),
});

export const GET = (request: NextRequest) => listMine(request);
