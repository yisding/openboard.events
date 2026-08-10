import { NextRequest } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/features/auth";
import { createLogisticsField, listLogisticsFields } from "@/features/portal";
import { createLogisticsFieldInputSchema, eventIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

const list = defineHandler({
  auth: adminAuth(),
  input: z.object({}),
  handler: ({ eventId }) => listLogisticsFields(eventIdSchema.parse(eventId)),
});

/** Organizer-defined event-scoped logistics field (work order §"Contract and
 * data additions"): text or single-select, applied to every speaker on this
 * event. */
const create = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: createLogisticsFieldInputSchema,
  handler: ({ eventId, input }) => createLogisticsField(eventIdSchema.parse(eventId), input),
});

export async function GET(request: NextRequest, route: { params: Promise<{ eventId: string }> }): Promise<Response> {
  return list(request, route);
}

export async function POST(request: NextRequest, route: { params: Promise<{ eventId: string }> }): Promise<Response> {
  return create(request, route);
}
