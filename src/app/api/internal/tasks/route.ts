import { z } from "zod";
import type { NextRequest } from "next/server";
import { eventIdSchema, taskTargetSchema } from "@/shared/contracts";
import { listTasksIn, tasksAdminAuth } from "@/features/portal/tasks-admin/server/queries";
import { db } from "@/db/client";
import { saveTaskIn, saveTaskInputSchema } from "@/features/portal/tasks-admin/server/mutations";
import { defineHandler } from "@/shared/server/handler";

const listInput = z.object({
  targetType: z.union([taskTargetSchema, z.literal("all")]).optional(),
  search: z.string().optional(),
});

const list = defineHandler({
  auth: tasksAdminAuth(),
  input: listInput,
  handler: async ({ eventId, input }) => listTasksIn(db, eventIdSchema.parse(eventId), input),
});

const create = defineHandler({
  auth: tasksAdminAuth({ role: "organizer" }),
  input: saveTaskInputSchema,
  handler: async ({ eventId, input }) => saveTaskIn(db, eventIdSchema.parse(eventId), input),
});

export function GET(request: NextRequest): Promise<Response> {
  return list(request);
}

export function POST(request: NextRequest): Promise<Response> {
  return create(request);
}
