import { NextRequest } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/features/auth";
import { deletePlan, getPlan, planUpdateSchema, requestWithPathValues, savePlan } from "@/features/submissions";
import { eventIdSchema, planIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

/**
 * Editing and removing one round. `expectedUpdatedAt` is optional and, when
 * sent, turns a concurrent edit into a 409 rather than a silent overwrite of
 * whatever the other organizer just changed.
 */
const update = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: planUpdateSchema,
  // The saved round travels back with its id, the same way the assignment and
  // reviewer writes hand back theirs: the editor's caller renders this row, and
  // a list that keeps its pre-save numbers until a reload contradicts the toast
  // that just said the save worked.
  handler: async ({ eventId, input }) => {
    const event = eventIdSchema.parse(eventId);
    const { expectedUpdatedAt, ...plan } = input;
    const saved = await savePlan(event, plan, expectedUpdatedAt);
    return { ...saved, plan: await getPlan(event, saved.planId) };
  },
});

const remove = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: z.object({ planId: planIdSchema }),
  handler: async ({ eventId, input }) => {
    await deletePlan(eventIdSchema.parse(eventId), input.planId);
    return { deleted: true };
  },
});

export async function PATCH(request: NextRequest, route: { params: Promise<{ eventId: string; planId: string }> }): Promise<Response> {
  const { planId } = await route.params;
  return update(await requestWithPathValues(request, { planId }), route);
}

export async function DELETE(request: NextRequest, route: { params: Promise<{ eventId: string; planId: string }> }): Promise<Response> {
  const { planId } = await route.params;
  return remove(await requestWithPathValues(request, { planId }), route);
}
