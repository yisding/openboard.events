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
  // Public submit path (PLAN P3-SEC): one draft-create per speaker+form is
  // the normal case, so this cap is generous — it exists to bound a scripted
  // loop, not a legitimate retry.
  rateLimit: { limit: 30, windowMs: 10 * 60 * 1000, key: ({ params, session }) => `form-draft:${params.formId}:${session?.actorId ?? "anon"}` },
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

const draftParticipant = z.object({
  clientId: z.string().min(1).max(100),
  email: z.email(),
  answers: z.record(z.string(), answerValueSchema),
  role: z.literal("co_speaker"),
  isPrimary: z.literal(false),
  sortOrder: z.int().min(1).max(100),
});

const save = defineHandler({
  auth: formPortalAuth,
  input: z.object({
    formVersion: z.int().positive(),
    answers: z.record(z.string(), answerValueSchema),
    participants: z.array(draftParticipant).max(20).optional(),
  }),
  // Autosave is debounced client-side and fires far more often than submit,
  // so its bucket is wider — still enough to stop a scripted flood.
  rateLimit: { limit: 120, windowMs: 10 * 60 * 1000, key: ({ params, session }) => `form-draft-save:${params.formId}:${session?.actorId ?? "anon"}` },
  handler: async ({ eventId, input, params, session }) => saveCfpDraft({
    eventId: eventIdSchema.parse(eventId),
    formId: formIdSchema.parse(params.formId),
    formVersion: input.formVersion,
    contactId: contactIdSchema.parse(session?.actorId),
    answers: input.answers,
    ...(input.participants ? { participants: input.participants } : {}),
  }),
});

export async function POST(request: NextRequest, route: { params: Promise<{ formId: string }> }): Promise<Response> {
  return draft(request, route);
}

export async function PATCH(request: NextRequest, route: { params: Promise<{ formId: string }> }): Promise<Response> {
  return save(request, route);
}
