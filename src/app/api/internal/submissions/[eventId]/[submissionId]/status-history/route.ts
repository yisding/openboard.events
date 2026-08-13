import { NextRequest } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/features/auth";
import { listSubmissionStatusHistory } from "@/features/submissions";
import { eventIdSchema, submissionIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

const history = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: z.object({ submissionId: submissionIdSchema }),
  handler: async ({ eventId, input }) => ({
    entries: await listSubmissionStatusHistory(eventIdSchema.parse(eventId), input.submissionId),
  }),
});

export async function GET(
  request: NextRequest,
  route: { params: Promise<{ eventId: string; submissionId: string }> },
): Promise<Response> {
  const { submissionId } = await route.params;
  const url = new URL(request.url);
  url.searchParams.set("submissionId", submissionId);
  return history(new NextRequest(url, request), route);
}
