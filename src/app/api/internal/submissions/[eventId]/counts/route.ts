import { NextRequest } from "next/server";
import { adminAuth } from "@/features/auth";
import { getStatusCounts, submissionFiltersSchema } from "@/features/submissions";
import { eventIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

/**
 * The tab counts, from the same filters the rows use — asking for them
 * separately is what would let the two disagree.
 */
const counts = defineHandler({
  auth: adminAuth(),
  input: submissionFiltersSchema,
  handler: async ({ eventId, input }) => getStatusCounts(eventIdSchema.parse(eventId), input),
});

export async function GET(request: NextRequest, route: { params: Promise<{ eventId: string }> }): Promise<Response> {
  return counts(request, route);
}
