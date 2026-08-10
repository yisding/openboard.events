import { NextRequest } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/features/auth";
import { removeSuppression } from "@/features/comms";
import { contactIdSchema, eventIdSchema } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

const routeParams = z.object({ contactId: contactIdSchema });

/**
 * M46 — reinstate: an organizer reviewed a bounce/complaint entry and
 * judged it stale. Deletes the `contact_suppressions` row outright — see
 * `removeSuppressionIn`'s docstring for why there is nothing else to flip.
 */
const remove = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: z.object({}),
  handler: async ({ eventId, params }) => {
    const { contactId } = routeParams.parse(params);
    const removed = await removeSuppression(eventIdSchema.parse(eventId), contactId);
    if (!removed) throw new AppError("NOT_FOUND", "This contact is not currently suppressed");
    return { ok: true };
  },
});

export function DELETE(request: NextRequest, route: { params: Promise<{ eventId: string; contactId: string }> }): Promise<Response> {
  return remove(request, route);
}
