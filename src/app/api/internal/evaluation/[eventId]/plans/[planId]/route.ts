import { NextRequest } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/features/auth";
import { deletePlan, planUpdateSchema, requestWithPathValues, savePlan } from "@/features/submissions";
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
  handler: async ({ eventId, input }) => {
    const { expectedUpdatedAt, ...plan } = input;
    return savePlan(eventIdSchema.parse(eventId), plan, expectedUpdatedAt);
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
