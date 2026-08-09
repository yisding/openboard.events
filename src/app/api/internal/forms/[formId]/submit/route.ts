import { NextRequest } from "next/server";
import { z } from "zod";
import { portalAuth } from "@/features/auth";
import { submitCfpForm } from "@/features/forms/server/submit";
import { answerValueSchema, contactIdSchema, eventIdSchema, formIdSchema, submissionIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

const rawAnswers = z.record(z.string(), answerValueSchema);

const inputSchema = z.object({
  eventId: eventIdSchema,
  formId: formIdSchema,
  formVersion: z.int().positive(),
  draftSubmissionId: submissionIdSchema.nullable().optional(),
  answers: rawAnswers,
  participants: z.array(z.object({
    contactId: contactIdSchema,
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
  auth: async (request, _eventId, params) => {
    const eventId = eventIdSchema.parse(new URL(request.url).searchParams.get("eventId"));
    const session = await portalAuth()(request, eventId, params);
    return session ? { ...session, eventId } : null;
  },
  input: inputSchema,
  handler: async ({ input, session }) => submitCfpForm({
    eventId: input.eventId,
    formId: input.formId,
    contactId: contactIdSchema.parse(session?.actorId),
    formVersion: input.formVersion,
    ...(input.draftSubmissionId ? { draftSubmissionId: input.draftSubmissionId } : {}),
    answers: input.answers,
    ...(input.participants
      ? {
        participants: input.participants.map((participant) => ({
          contactId: participant.contactId,
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
  const { formId } = await route.params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const url = new URL(request.url);
  url.searchParams.set("eventId", String(body.eventId ?? ""));
  return submit(new NextRequest(url, { method: "POST", headers: request.headers, body: JSON.stringify({ ...body, formId }) }));
}
