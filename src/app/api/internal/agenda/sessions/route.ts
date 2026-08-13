import type { NextRequest } from "next/server";
import { z } from "zod";
import { agendaAuth, createSessionInputSchema, listSessions, saveSession } from "@/features/agenda";
import { eventIdSchema, roomIdSchema, sessionStatusSchema, trackIdSchema, userIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";
import { revalidatePublicEvent } from "@/shared/server/revalidate-public";
import { nudgeAfterEnqueue } from "../nudge";

export const dynamic = "force-dynamic";

/**
 * The agenda's collection endpoint. `eventId` arrives as a query parameter and
 * is resolved by the guard, so neither handler below can run — let alone
 * query — without an authorized event in hand.
 */
const listInput = z.object({
  eventId: eventIdSchema,
  search: z.string().max(200).optional(),
  trackId: trackIdSchema.optional(),
  roomId: roomIdSchema.optional(),
  status: z.union([sessionStatusSchema, z.literal("all")]).optional(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const list = defineHandler({
  auth: agendaAuth({ role: "reviewer" }),
  input: listInput,
  handler: async ({ input }) => listSessions(input.eventId, {
    ...(input.search === undefined ? {} : { search: input.search }),
    ...(input.trackId === undefined ? {} : { trackId: input.trackId }),
    ...(input.roomId === undefined ? {} : { roomId: input.roomId }),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.day === undefined ? {} : { day: input.day }),
  }),
});

const create = defineHandler({
  auth: agendaAuth(),
  input: createSessionInputSchema,
  handler: async ({ eventId, input, requestId, session: authSession }) => {
    const scopedEventId = eventIdSchema.parse(eventId);
    const actorUserId = authSession?.actorId ? userIdSchema.parse(authSession.actorId) : null;
    const session = await saveSession(scopedEventId, input, actorUserId);
    // A session created already published and already timed has just told its
    // speakers; trim the cron latency without making the organizer wait on it.
    if (session.status === "published" && session.startsAt !== null) nudgeAfterEnqueue();
    // Same reason the PATCH route revalidates: a session created already
    // published is on the public pages the moment it commits, and it must not
    // be more stale than the identical session published by a later edit.
    await revalidatePublicEvent(scopedEventId, ["schedule", "speakers"], requestId);
    return session;
  },
});

export function GET(request: NextRequest): Promise<Response> {
  return list(request);
}

export function POST(request: NextRequest): Promise<Response> {
  return create(request);
}
