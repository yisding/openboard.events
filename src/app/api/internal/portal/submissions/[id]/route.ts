import { NextRequest } from "next/server";
import { z } from "zod";
import { portalAuth } from "@/features/auth";
import { getMySubmission } from "@/features/portal";
import { contactIdSchema, eventIdSchema } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

const getMine = defineHandler({
  auth: async (request, _eventId, params) => {
    const eventId = eventIdSchema.parse(new URL(request.url).searchParams.get("eventId"));
    const session = await portalAuth()(request, eventId, params);
    return session ? { ...session, eventId } : null;
  },
  input: z.object({ eventId: eventIdSchema, id: z.uuid() }),
  handler: async ({ input, session }) => {
    const submission = await getMySubmission(input.eventId, contactIdSchema.parse(session?.actorId), input.id);
    // A submission the caller is not on reads exactly like one that does not
    // exist, so probing ids tells an attacker nothing.
    if (!submission) throw new AppError("NOT_FOUND", "Submission not found");
    return submission;
  },
});

export async function GET(request: NextRequest, route: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await route.params;
  const url = new URL(request.url);
  url.searchParams.set("id", id);
  return getMine(new NextRequest(url, request));
}
