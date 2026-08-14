import { NextRequest } from "next/server";
import { z } from "zod";
import { submitCfpForm } from "@/features/cfp";
import { revalidatePublicEvent } from "@/features/public/server/revalidate";
import { answerValueSchema, contactIdSchema, eventIdSchema, formIdSchema, participantRoleSchema, submissionIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";
import { clientIp } from "@/shared/server/rate-limit";
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
    role: participantRoleSchema,
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
  // Public submit path (PLAN P3-SEC): the speaker is portal-authed, but
  // final-submit still triggers routing, an email, and a code allocation, so
  // it stays capped per speaker+form independent of the account-wide login
  // throttle in requestPortalLoginIn. Falls back to IP only in the
  // unreachable case where formPortalAuth resolves without a session.
  rateLimit: {
    limit: 30,
    windowMs: 10 * 60 * 1000,
    key: ({ request, params, session }) => `submit:${params.formId}:${session?.actorId ?? clientIp(request)}`,
  },
  handler: async ({ eventId, input, params, session, requestId }) => {
    const scopedEventId = eventIdSchema.parse(eventId);
    const result = await submitCfpForm({
      eventId: scopedEventId,
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
    });
    await revalidatePublicEvent(scopedEventId, ["schedule", "speakers"], requestId);
    return result;
  },
});

export async function POST(request: NextRequest, route: { params: Promise<{ formId: string }> }): Promise<Response> {
  return submit(request, route);
}
