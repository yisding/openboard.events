import { NextRequest } from "next/server";
import { adminAuth } from "@/features/auth";
import { listSubmissions, submissionFiltersSchema } from "@/features/submissions";
import { eventIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

/**
 * The Abstracts table's rows. Admin auth with no role requirement: a reviewer
 * has to be able to read the submissions they are reviewing.
 */
const list = defineHandler({
  auth: adminAuth(),
  input: submissionFiltersSchema,
  handler: async ({ eventId, input }) => listSubmissions(eventIdSchema.parse(eventId), input),
});

export async function GET(request: NextRequest, route: { params: Promise<{ eventId: string }> }): Promise<Response> {
  return list(request, route);
}
