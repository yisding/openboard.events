import type { NextRequest } from "next/server";
import { z } from "zod";
import { eventIdSchema, fileRequestIdSchema } from "@/shared/contracts";
import { db } from "@/db/client";
import { getFileRequestIn, tasksAdminAuth } from "@/features/portal/tasks-admin/server/queries";
import { deleteFileRequestIn, saveFileRequestInputSchema, saveFileRequestIn } from "@/features/portal/tasks-admin/server/mutations";
import { AppError } from "@/shared/lib/errors";
import { defineHandler } from "@/shared/server/handler";

const routeParams = z.object({ id: fileRequestIdSchema });

const get = defineHandler({
  auth: tasksAdminAuth(),
  input: z.object({}),
  handler: async ({ eventId, params }) => {
    const { id } = routeParams.parse(params);
    const request = await getFileRequestIn(db, eventIdSchema.parse(eventId), id);
    if (!request) throw new AppError("NOT_FOUND", "File request not found");
    return request;
  },
});

const update = defineHandler({
  auth: tasksAdminAuth({ role: "organizer" }),
  input: saveFileRequestInputSchema,
  handler: async ({ eventId, input, params }) => {
    const { id } = routeParams.parse(params);
    return saveFileRequestIn(db, eventIdSchema.parse(eventId), { ...input, id });
  },
});

const remove = defineHandler({
  auth: tasksAdminAuth({ role: "organizer" }),
  input: z.object({}),
  handler: async ({ eventId, params }) => {
    const { id } = routeParams.parse(params);
    await deleteFileRequestIn(db, eventIdSchema.parse(eventId), id);
    return { ok: true };
  },
});

type Route = { params: Promise<{ id: string }> };

export function GET(request: NextRequest, route: Route): Promise<Response> {
  return get(request, route);
}

export function PATCH(request: NextRequest, route: Route): Promise<Response> {
  return update(request, route);
}

export function DELETE(request: NextRequest, route: Route): Promise<Response> {
  return remove(request, route);
}
