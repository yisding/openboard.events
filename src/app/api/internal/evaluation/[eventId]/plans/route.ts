import { NextRequest } from "next/server";
import { adminAuth } from "@/features/auth";
import { getPlan, listPlans, planCreateInputSchema, savePlan } from "@/features/submissions";
import { eventIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";
import { z } from "zod";

export const dynamic = "force-dynamic";

/**
 * The event's scoring rounds. Any member may read them — a reviewer's queue page
 * needs the plan switcher — but only an organizer may write one.
 */
const list = defineHandler({
  auth: adminAuth(),
  input: z.object({}).loose(),
  handler: async ({ eventId }) => ({ plans: await listPlans(eventIdSchema.parse(eventId)) }),
});

const create = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: planCreateInputSchema,
  // As with PATCH: the new round comes back whole, so the list it belongs to
  // can show it without waiting for a reload.
  handler: async ({ eventId, input }) => {
    const event = eventIdSchema.parse(eventId);
    const saved = await savePlan(event, input);
    return { ...saved, plan: await getPlan(event, saved.planId) };
  },
});

export async function GET(request: NextRequest, route: { params: Promise<{ eventId: string }> }): Promise<Response> {
  return list(request, route);
}

export async function POST(request: NextRequest, route: { params: Promise<{ eventId: string }> }): Promise<Response> {
  return create(request, route);
}
