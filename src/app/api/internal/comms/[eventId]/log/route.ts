import { NextRequest } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/features/auth";
import { listLog } from "@/features/comms";
import { commStatusSchema, contactIdSchema, eventIdSchema, templateKeySchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

const filtersSchema = z.object({
  status: commStatusSchema.optional(),
  templateKey: templateKeySchema.optional(),
  contactId: contactIdSchema.optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});

/**
 * The audit/trust surface. `contactId` is what lets `<CommsLogTable>` serve
 * both the event-wide Log tab and a single speaker's history (M27's speaker
 * detail) off one query — the filter narrows, it never widens past `eventId`.
 */
const list = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: filtersSchema,
  handler: async ({ eventId, input }) => listLog(eventIdSchema.parse(eventId), {
    ...(input.status ? { status: input.status } : {}),
    ...(input.templateKey ? { templateKey: input.templateKey } : {}),
    ...(input.contactId ? { contactId: input.contactId } : {}),
    ...(input.limit ? { limit: input.limit } : {}),
  }),
});

export async function GET(request: NextRequest, route: { params: Promise<{ eventId: string }> }): Promise<Response> {
  return list(request, route);
}
