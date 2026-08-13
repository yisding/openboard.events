import type { NextRequest } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/features/auth";
import { eventAccessRoleInputSchema, removeEventAccessMember, setEventAccessMember } from "@/features/organizations";
import { eventIdSchema, userIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

const remove = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: z.object({}),
  handler: async ({ eventId, params, session }) => {
    await removeEventAccessMember(
      eventIdSchema.parse(eventId),
      userIdSchema.parse(session?.actorId),
      userIdSchema.parse(params.userId),
    );
    return { removed: true };
  },
});

const set = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: eventAccessRoleInputSchema,
  handler: ({ eventId, input, params, session }) => setEventAccessMember(
    eventIdSchema.parse(eventId),
    userIdSchema.parse(session?.actorId),
    userIdSchema.parse(params.userId),
    input.role,
  ),
});

export function PATCH(request: NextRequest, route: { params: Promise<{ eventId: string; userId: string }> }): Promise<Response> {
  return set(request, route);
}

export function DELETE(request: NextRequest, route: { params: Promise<{ eventId: string; userId: string }> }): Promise<Response> {
  return remove(request, route);
}
