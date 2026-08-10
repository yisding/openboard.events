import type { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/db/client";
import { adminAuth } from "@/features/auth";
import { getResourcePageByIdIn } from "@/features/portal/resources/server/queries";
import { deleteResourcePageIn, saveResourcePageIn, saveResourcePageRequestSchema } from "@/features/portal/resources/server/mutations";
import { eventIdSchema } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { defineHandler } from "@/shared/server/handler";

const routeParams = z.object({ pageId: z.uuid() });

const get = defineHandler({
  auth: adminAuth(),
  input: z.object({}),
  handler: async ({ eventId, params }) => {
    const { pageId } = routeParams.parse(params);
    const page = await getResourcePageByIdIn(db, eventIdSchema.parse(eventId), pageId);
    if (!page) throw new AppError("NOT_FOUND", "Resource page not found");
    return page;
  },
});

// The route's `pageId` segment is authoritative — whatever `id` (if any) rides
// along in the body is overwritten below rather than trusted.
const update = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: saveResourcePageRequestSchema,
  handler: async ({ eventId, input, params }) => {
    const { pageId } = routeParams.parse(params);
    const { expectedUpdatedAt, ...pageInput } = input;
    return saveResourcePageIn(db, eventIdSchema.parse(eventId), { ...pageInput, id: pageId }, expectedUpdatedAt);
  },
});

const remove = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: z.object({}),
  handler: async ({ eventId, params }) => {
    const { pageId } = routeParams.parse(params);
    await deleteResourcePageIn(db, eventIdSchema.parse(eventId), pageId);
    return { ok: true };
  },
});

type Route = { params: Promise<{ eventId: string; pageId: string }> };

export function GET(request: NextRequest, route: Route): Promise<Response> {
  return get(request, route);
}

export function PATCH(request: NextRequest, route: Route): Promise<Response> {
  return update(request, route);
}

export function DELETE(request: NextRequest, route: Route): Promise<Response> {
  return remove(request, route);
}
