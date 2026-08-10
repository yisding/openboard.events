import { NextRequest } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/features/auth";
import { deleteLogisticsField } from "@/features/portal";
import { eventIdSchema, logisticsFieldIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

const routeParams = z.object({ fieldId: logisticsFieldIdSchema });

/** Cascades to every contact's stored value for this field (drizzle/0008's
 * `ON DELETE CASCADE`) — removing a field cleans up its answers in the same
 * statement rather than leaving orphaned rows a reused id could inherit. */
const remove = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: z.object({}),
  handler: async ({ eventId, params }) => {
    const { fieldId } = routeParams.parse(params);
    await deleteLogisticsField(eventIdSchema.parse(eventId), fieldId);
    return { ok: true };
  },
});

export function DELETE(request: NextRequest, route: { params: Promise<{ eventId: string; fieldId: string }> }): Promise<Response> {
  return remove(request, route);
}
