import { NextRequest } from "next/server";
import { adminAuth } from "@/features/auth";
import { listSubmissions, submissionFiltersSchema } from "@/features/submissions";
import { eventIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

/**
 * The organizer Abstracts table's rows. Reviewers use the evaluation queue,
 * whose server query applies their plan and assignment scope.
 */
const list = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: submissionFiltersSchema,
  handler: async ({ eventId, input }) => listSubmissions(eventIdSchema.parse(eventId), input),
});

export async function GET(request: NextRequest, route: { params: Promise<{ eventId: string }> }): Promise<Response> {
  return list(request, route);
}
