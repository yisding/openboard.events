import type { NextRequest } from "next/server";
import { z } from "zod";
import { getEvent, updateEvent, updateEventBodySchema } from "@/features/events";
import { adminAuth } from "@/features/auth";
import { eventIdSchema } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { defineHandler } from "@/shared/server/handler";

const get_ = defineHandler({
  auth: adminAuth(),
  input: z.object({}),
  handler: async ({ eventId }) => {
    const event = await getEvent(eventIdSchema.parse(eventId));
    if (!event) throw new AppError("NOT_FOUND", "Event not found");
    return event;
  },
});

const patch = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: updateEventBodySchema,
  handler: async ({ eventId, input }) => updateEvent(eventIdSchema.parse(eventId), input.patch, input.expectedRowVersion),
});

export function GET(request: NextRequest, route: { params: Promise<{ eventId: string }> }): Promise<Response> {
  return get_(request, route);
}

export function PATCH(request: NextRequest, route: { params: Promise<{ eventId: string }> }): Promise<Response> {
  return patch(request, route);
}
