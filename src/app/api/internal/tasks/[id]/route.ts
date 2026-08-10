import { z } from "zod";
import type { NextRequest } from "next/server";
import { eventIdSchema, taskIdSchema } from "@/shared/contracts";
import { db } from "@/db/client";
import { getTaskCompletionMatrixIn, getTaskIn, tasksAdminAuth } from "@/features/portal/tasks-admin/server/queries";
import { deleteTaskIn, saveTaskInputSchema, saveTaskIn } from "@/features/portal/tasks-admin/server/mutations";
import { AppError } from "@/shared/lib/errors";
import { defineHandler } from "@/shared/server/handler";

const routeParams = z.object({ id: taskIdSchema });

const get = defineHandler({
  auth: tasksAdminAuth(),
  input: z.object({}),
  handler: async ({ eventId, params }) => {
    const { id } = routeParams.parse(params);
    const scopedEventId = eventIdSchema.parse(eventId);
    const [task, assignments] = await Promise.all([
      getTaskIn(db, scopedEventId, id),
      getTaskCompletionMatrixIn(db, scopedEventId, id),
    ]);
    if (!task) throw new AppError("NOT_FOUND", "Task not found");
    return { task, assignments };
  },
});

const update = defineHandler({
  auth: tasksAdminAuth({ role: "organizer" }),
  // The route's `id` segment is authoritative — whatever `id` (if any) rides
  // along in the body is overwritten below rather than trusted.
  input: saveTaskInputSchema,
  handler: async ({ eventId, input, params }) => {
    const { id } = routeParams.parse(params);
    return saveTaskIn(db, eventIdSchema.parse(eventId), { ...input, id });
  },
});

const remove = defineHandler({
  auth: tasksAdminAuth({ role: "organizer" }),
  input: z.object({}),
  handler: async ({ eventId, params }) => {
    const { id } = routeParams.parse(params);
    await deleteTaskIn(db, eventIdSchema.parse(eventId), id);
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
