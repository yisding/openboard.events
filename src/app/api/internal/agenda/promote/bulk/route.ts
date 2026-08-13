import type { NextRequest } from "next/server";
import { z } from "zod";
import { agendaAuth, bulkPromoteSubmissions } from "@/features/agenda";
import { eventIdSchema, MAX_BULK_AGENDA_PROMOTIONS, submissionIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

const bulkPromoteInputSchema = z.object({
  submissionIds: z.array(submissionIdSchema).min(1).max(MAX_BULK_AGENDA_PROMOTIONS),
}).superRefine((value, context) => {
  if (new Set(value.submissionIds).size !== value.submissionIds.length) {
    context.addIssue({ code: "custom", path: ["submissionIds"], message: "Each abstract may only be selected once" });
  }
});

/**
 * A bounded organizer batch over the same event-scoped, idempotent promotion
 * primitive as the single-row route. Results retain one outcome per requested
 * abstract so a partial rejection never masquerades as an all-success toast.
 */
const bulkPromote = defineHandler({
  auth: agendaAuth(),
  input: bulkPromoteInputSchema,
  handler: async ({ eventId, input }) => bulkPromoteSubmissions(eventIdSchema.parse(eventId), input.submissionIds),
});

export function POST(request: NextRequest): Promise<Response> {
  return bulkPromote(request);
}
