import { NextRequest } from "next/server";
import { z } from "zod";
import { submitCfpForm } from "@/features/forms/server/submit";
import { answerValueSchema, contactIdSchema, eventIdSchema, formIdSchema, submissionIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";
import { formPortalAuth } from "../_lib";

export const dynamic = "force-dynamic";

const rawAnswers = z.record(z.string(), answerValueSchema);

const inputSchema = z.object({
  formVersion: z.int().positive(),
  draftSubmissionId: submissionIdSchema.nullable().optional(),
  answers: rawAnswers,
  participants: z.array(z.object({
    clientId: z.string().trim().min(1).max(100),
    email: z.string().trim().pipe(z.email()).transform((email) => email.toLowerCase()),
    role: z.enum(["speaker", "co_speaker"]),
    isPrimary: z.boolean(),
    sortOrder: z.int().nonnegative(),
    answers: rawAnswers.optional(),
  })).optional(),
});

/**
 * The CFP submit. Portal auth: a speaker submits as themselves, and the contact
 * comes from the session rather than the body — a body-supplied contact id is
 * how one speaker submits as another.
 */
const submit = defineHandler({
  auth: formPortalAuth,
  input: inputSchema,
  handler: async ({ eventId, input, params, session }) => submitCfpForm({
    eventId: eventIdSchema.parse(eventId),
    formId: formIdSchema.parse(params.formId),
    contactId: contactIdSchema.parse(session?.actorId),
    formVersion: input.formVersion,
    ...(input.draftSubmissionId ? { draftSubmissionId: input.draftSubmissionId } : {}),
    answers: input.answers,
    ...(input.participants
      ? {
        participants: input.participants.map((participant) => ({
          clientId: participant.clientId,
          email: participant.email,
          role: participant.role,
          isPrimary: participant.isPrimary,
          sortOrder: participant.sortOrder,
          ...(participant.answers ? { answers: participant.answers } : {}),
        })),
      }
      : {}),
  }),
});

export async function POST(request: NextRequest, route: { params: Promise<{ formId: string }> }): Promise<Response> {
  return submit(request, route);
}
