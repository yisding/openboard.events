import type { NextRequest } from "next/server";
import { z } from "zod";
import { createEvent, createEventInputSchema, listEvents } from "@/features/events";
import { eventsHubAuth } from "@/features/events/server/guards";
import { userIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

const list = defineHandler({
  auth: eventsHubAuth(),
  input: z.object({}),
  handler: async () => listEvents(),
});

const create = defineHandler({
  auth: eventsHubAuth(),
  input: createEventInputSchema,
  handler: async ({ session, input }) => createEvent(userIdSchema.parse(session?.actorId), input),
});

export function GET(request: NextRequest): Promise<Response> {
  return list(request);
}

export function POST(request: NextRequest): Promise<Response> {
  return create(request);
}
