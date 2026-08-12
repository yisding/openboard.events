import { NextRequest } from "next/server";
import { adminAuth } from "@/features/auth";
import { createSubmission, listSubmissions, submissionFiltersSchema } from "@/features/submissions";
import { eventIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";
import { manualAbstractSchema, toCreateSubmissionInput } from "./_lib";

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

/**
 * "Add abstract" — the invited keynote that never went through the CFP.
 *
 * Delegates to M18's `createSubmission` — this route allocates no code and
 * writes no row itself. The repository has exactly one submission-insert site
 * and it is not here (resolution #8). The schema and the mapping live in
 * `_lib.ts` so they can be tested without standing the route up.
 */
const create = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: manualAbstractSchema,
  handler: async ({ eventId, input }) => createSubmission(eventIdSchema.parse(eventId), toCreateSubmissionInput(input)),
});

export async function GET(request: NextRequest, route: { params: Promise<{ eventId: string }> }): Promise<Response> {
  return list(request, route);
}

export async function POST(request: NextRequest, route: { params: Promise<{ eventId: string }> }): Promise<Response> {
  return create(request, route);
}
