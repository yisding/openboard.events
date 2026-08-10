import { NextRequest } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/features/auth";
import {
  assignSubmissions,
  assignmentInputSchema,
  getPlan,
  listAssignableSubmissions,
  requestWithPathValues,
} from "@/features/submissions";
import { eventIdSchema, planIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

/**
 * Explicit assignment of submissions to reviewers.
 *
 * The queue a reviewer sees is exactly these rows, so this is an organizer-only
 * write; `mode: "replace"` is the honest way to take work back, and neither mode
 * resurrects a recusal.
 */
const assign = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: assignmentInputSchema,
  handler: async ({ eventId, input }) => {
    const event = eventIdSchema.parse(eventId);
    const result = await assignSubmissions(event, input);
    return { ...result, plan: await getPlan(event, input.planId) };
  },
});

/** What is available to hand out in this round, and who already has each. */
const list = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: z.object({ planId: planIdSchema }),
  handler: async ({ eventId, input }) => ({
    submissions: await listAssignableSubmissions(eventIdSchema.parse(eventId), input.planId),
  }),
});

export async function GET(request: NextRequest, route: { params: Promise<{ eventId: string; planId: string }> }): Promise<Response> {
  const { planId } = await route.params;
  const url = new URL(request.url);
  url.searchParams.set("planId", planId);
  return list(new NextRequest(url, request), route);
}

export async function PUT(request: NextRequest, route: { params: Promise<{ eventId: string; planId: string }> }): Promise<Response> {
  const { planId } = await route.params;
  return assign(await requestWithPathValues(request, { planId }), route);
}
