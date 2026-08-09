import { NextRequest } from "next/server";
import { z } from "zod";
import { getMySubmission } from "@/features/portal";
import { eventIdSchema } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { defineHandler } from "@/shared/server/handler";
import { portalQueryAuth, sessionContactId } from "../../_lib";

export const dynamic = "force-dynamic";

const getMine = defineHandler({
  auth: portalQueryAuth,
  input: z.object({ eventId: eventIdSchema, id: z.uuid() }),
  handler: async ({ input, session }) => {
    const submission = await getMySubmission(input.eventId, sessionContactId(session), input.id);
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
