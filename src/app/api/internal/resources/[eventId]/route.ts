import type { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/db/client";
import { adminAuth } from "@/features/auth";
import { listResourcePagesIn } from "@/features/portal/resources/server/queries";
import {
  createResourcePageIn,
  createResourcePageRequestSchema,
  reorderResourcePagesIn,
  reorderResourcePagesInputSchema,
} from "@/features/portal/resources/server/mutations";
import { eventIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

/** GET = every page for the event, published and draft alike — the admin table shows both. */
const list = defineHandler({
  auth: adminAuth(),
  input: z.object({}),
  handler: async ({ eventId }) => listResourcePagesIn(db, eventIdSchema.parse(eventId)),
});

const create = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: createResourcePageRequestSchema,
  handler: async ({ eventId, input }) => createResourcePageIn(db, eventIdSchema.parse(eventId), input),
});

/** PATCH on the collection = reorder — the whole list renumbered in one statement, never a per-row drag event. */
const reorder = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: reorderResourcePagesInputSchema,
  handler: async ({ eventId, input }) => {
    await reorderResourcePagesIn(db, eventIdSchema.parse(eventId), input.orderedIds);
    return { ok: true };
  },
});

type Route = { params: Promise<{ eventId: string }> };

export function GET(request: NextRequest, route: Route): Promise<Response> {
  return list(request, route);
}

export function POST(request: NextRequest, route: Route): Promise<Response> {
  return create(request, route);
}

export function PATCH(request: NextRequest, route: Route): Promise<Response> {
  return reorder(request, route);
}
