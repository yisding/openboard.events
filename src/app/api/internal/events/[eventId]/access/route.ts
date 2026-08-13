import type { NextRequest } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/features/auth";
import { getEventAccessOverview } from "@/features/organizations";
import { eventIdSchema, userIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

const list = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: z.object({}),
  handler: ({ eventId, session }) => getEventAccessOverview(
    eventIdSchema.parse(eventId),
    userIdSchema.parse(session?.actorId),
  ),
});

export function GET(request: NextRequest, route: { params: Promise<{ eventId: string }> }): Promise<Response> {
  return list(request, route);
}
