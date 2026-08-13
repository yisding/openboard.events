import type { NextRequest } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/features/auth";
import { removeEventAccessMember } from "@/features/organizations";
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

export function DELETE(request: NextRequest, route: { params: Promise<{ eventId: string; userId: string }> }): Promise<Response> {
  return remove(request, route);
}
