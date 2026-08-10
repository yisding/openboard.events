import { NextRequest } from "next/server";
import { z } from "zod";
import { saveCfpDraft } from "@/features/forms/server/submit";
import { upsertDraft } from "@/features/submissions";
import { answerValueSchema, contactIdSchema, eventIdSchema, formIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";
import { formPortalAuth } from "../_lib";

export const dynamic = "force-dynamic";

/**
 * The server draft the wizard's Account step creates, so a speaker's answers
 * have somewhere to live — and a SESS code — from the moment they give an email.
 */
const draft = defineHandler({
  auth: formPortalAuth,
  input: z.object({ formVersion: z.int().positive() }),
  handler: async ({ eventId, input, params, session }) => {
    const result = await upsertDraft(
      eventIdSchema.parse(eventId),
      contactIdSchema.parse(session?.actorId),
      formIdSchema.parse(params.formId),
      input.formVersion,
    );
    return { ...result, formVersion: input.formVersion };
  },
});

const save = defineHandler({
  auth: formPortalAuth,
  input: z.object({
    formVersion: z.int().positive(),
    answers: z.record(z.string(), answerValueSchema),
  }),
  handler: async ({ eventId, input, params, session }) => saveCfpDraft({
    eventId: eventIdSchema.parse(eventId),
    formId: formIdSchema.parse(params.formId),
    formVersion: input.formVersion,
    contactId: contactIdSchema.parse(session?.actorId),
    answers: input.answers,
  }),
});

export async function POST(request: NextRequest, route: { params: Promise<{ formId: string }> }): Promise<Response> {
  return draft(request, route);
}

export async function PATCH(request: NextRequest, route: { params: Promise<{ formId: string }> }): Promise<Response> {
  return save(request, route);
}
