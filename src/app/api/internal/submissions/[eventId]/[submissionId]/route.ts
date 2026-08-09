import { NextRequest } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/features/auth";
import { getSubmissionDetail } from "@/features/submissions";
import { eventIdSchema, submissionIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

/**
 * One submission with its answers and the snapshot they were written against.
 * Any member may read it — a reviewer cannot review what they cannot open.
 */
const detail = defineHandler({
  auth: adminAuth(),
  input: z.object({ submissionId: submissionIdSchema }),
  handler: async ({ eventId, input }) => getSubmissionDetail(eventIdSchema.parse(eventId), input.submissionId),
});

export async function GET(request: NextRequest, route: { params: Promise<{ eventId: string; submissionId: string }> }): Promise<Response> {
  const { submissionId } = await route.params;
  const url = new URL(request.url);
  url.searchParams.set("submissionId", submissionId);
  return detail(new NextRequest(url, request), route);
}
