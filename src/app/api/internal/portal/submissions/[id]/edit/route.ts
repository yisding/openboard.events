import { NextRequest } from "next/server";
import { z } from "zod";
import { applySubmissionEdit } from "@/features/portal/submissions-edit/server/queries";
import { answerValueSchema, eventIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";
import { portalQueryAuth, requestWithPathValues, sessionContactId } from "../../../_lib";

export const dynamic = "force-dynamic";

const rawAnswers = z.record(z.string(), answerValueSchema);

/**
 * The speaker's own edit — a distinct route file from M21's
 * `GET .../submissions/[id]/route.ts`, so the two modules' route ownership
 * stays disjoint.
 *
 * Everything that matters happens inside `applySubmissionEdit`: the gate is
 * re-run against the database clock, M16's pure pipeline turns the raw payload
 * into `CleanAnswers`, and the one write goes through M18's
 * `updateSubmissionFromCfp`. This handler only authenticates, validates the
 * shape, and translates the id in the URL into the body `defineHandler` parses.
 */
const editSubmission = defineHandler({
  auth: portalQueryAuth,
  input: z.object({
    id: z.uuid(),
    formVersion: z.int().positive(),
    answers: rawAnswers,
  }),
  handler: async ({ eventId, session, input }) => applySubmissionEdit(
    eventIdSchema.parse(eventId),
    sessionContactId(session),
    input.id,
    input.formVersion,
    input.answers,
  ),
});

export async function POST(request: NextRequest, route: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await route.params;
  return editSubmission(await requestWithPathValues(request, { id }));
}
