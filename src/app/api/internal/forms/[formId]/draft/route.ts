import { NextRequest } from "next/server";
import { z } from "zod";
import { portalAuth } from "@/features/auth";
import { upsertDraft } from "@/features/submissions";
import { contactIdSchema, eventIdSchema, formIdSchema } from "@/shared/contracts";
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

export async function POST(request: NextRequest, route: { params: Promise<{ formId: string }> }): Promise<Response> {
  const { formId } = await route.params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const url = new URL(request.url);
  url.searchParams.set("eventId", String(body.eventId ?? ""));
  return draft(new NextRequest(url, { method: "POST", headers: request.headers, body: JSON.stringify({ ...body, formId }) }));
}
