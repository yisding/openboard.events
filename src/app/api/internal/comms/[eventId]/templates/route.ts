import { NextRequest } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/features/auth";
import { listTemplates, saveTemplate, templateSaveInputSchema } from "@/features/comms";
import { eventIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

/** The 8-key rail's data — always `TEMPLATE_KEYS` order (see `listTemplatesIn`). */
const list = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: z.object({}),
  handler: async ({ eventId }) => listTemplates(eventIdSchema.parse(eventId)),
});

/**
 * One key at a time. Unknown-variable validation and `sanitize()` both run
 * inside `saveTemplate` — this route is a thin, guarded pass-through, not a
 * second place either check could be skipped.
 */
const save = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: templateSaveInputSchema,
  handler: async ({ eventId, input }) => {
    const { key, ...patch } = input;
    return saveTemplate(eventIdSchema.parse(eventId), key, patch);
  },
});

export async function GET(request: NextRequest, route: { params: Promise<{ eventId: string }> }): Promise<Response> {
  return list(request, route);
}

export async function PATCH(request: NextRequest, route: { params: Promise<{ eventId: string }> }): Promise<Response> {
  return save(request, route);
}
