import { NextRequest } from "next/server";
import { z } from "zod";
import { portalAuth } from "@/features/auth";
import { saveCfpDraft } from "@/features/forms/server/submit";
import { upsertDraft } from "@/features/submissions";
import { answerValueSchema, contactIdSchema, eventIdSchema, formIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

/**
 * The server draft the wizard's Account step creates, so a speaker's answers
 * have somewhere to live — and a SESS code — from the moment they give an email.
 */
const draft = defineHandler({
  auth: async (request, _eventId, params) => {
    const eventId = eventIdSchema.parse(new URL(request.url).searchParams.get("eventId"));
    const session = await portalAuth()(request, eventId, params);
    return session ? { ...session, eventId } : null;
  },
  input: z.object({ eventId: eventIdSchema, formId: formIdSchema, formVersion: z.int().positive() }),
  handler: async ({ input, session }) => upsertDraft(
    input.eventId,
    contactIdSchema.parse(session?.actorId),
    input.formId,
    input.formVersion,
  ),
});

const save = defineHandler({
  auth: async (request, _eventId, params) => {
    const eventId = eventIdSchema.parse(new URL(request.url).searchParams.get("eventId"));
    const session = await portalAuth()(request, eventId, params);
    return session ? { ...session, eventId } : null;
  },
  input: z.object({
    eventId: eventIdSchema,
    formId: formIdSchema,
    formVersion: z.int().positive(),
    answers: z.record(z.string(), answerValueSchema),
  }),
  handler: async ({ input, session }) => saveCfpDraft({
    eventId: input.eventId,
    formId: input.formId,
    formVersion: input.formVersion,
    contactId: contactIdSchema.parse(session?.actorId),
    answers: input.answers,
  }),
});

function withRouteForm(request: NextRequest, formId: string, body: Record<string, unknown>, method: "POST" | "PATCH") {
  const url = new URL(request.url);
  url.searchParams.set("eventId", String(body.eventId ?? ""));
  return new NextRequest(url, { method, headers: request.headers, body: JSON.stringify({ ...body, formId }) });
}

export async function POST(request: NextRequest, route: { params: Promise<{ formId: string }> }): Promise<Response> {
  const { formId } = await route.params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  return draft(withRouteForm(request, formId, body, "POST"));
}

export async function PATCH(request: NextRequest, route: { params: Promise<{ formId: string }> }): Promise<Response> {
  const { formId } = await route.params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  return save(withRouteForm(request, formId, body, "PATCH"));
}
