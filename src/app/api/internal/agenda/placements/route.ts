import type { NextRequest } from "next/server";
import { z } from "zod";
import { agendaAuth, previewPlacements } from "@/features/agenda";
import { eventIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

/**
 * M54's "one action previews conflict-safe slots" step. Read-only — the
 * planner never writes — so it is a GET like every other agenda list read,
 * not a POST like `moveSession`.
 */
const preview = defineHandler({
  auth: agendaAuth(),
  input: z.object({ eventId: eventIdSchema }),
  handler: async ({ input }) => previewPlacements(input.eventId),
});

export function GET(request: NextRequest): Promise<Response> {
  return preview(request);
}
