import type { NextRequest } from "next/server";
import { z } from "zod";
import { agendaAuth, promoteSubmission } from "@/features/agenda";
import { eventIdSchema, submissionIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

/**
 * Accepted abstract → linked draft session, idempotently. A double-click returns
 * the same `sessionId` rather than a second session, because the mutation looks
 * for an existing link before it inserts and `sessions.submission_id` is UNIQUE
 * behind it.
 */
const promote = defineHandler({
  auth: agendaAuth(),
  input: z.object({ submissionId: submissionIdSchema }),
  handler: async ({ eventId, input }) => promoteSubmission(eventIdSchema.parse(eventId), input.submissionId),
});

export function POST(request: NextRequest): Promise<Response> {
  return promote(request);
}
