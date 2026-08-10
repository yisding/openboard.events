import type { NextRequest } from "next/server";
import { z } from "zod";
import { eventIdSchema } from "@/shared/contracts";
import { db } from "@/db/client";
import { listFileRequestsIn, tasksAdminAuth } from "@/features/portal/tasks-admin/server/queries";
import { saveFileRequestIn, saveFileRequestInputSchema } from "@/features/portal/tasks-admin/server/mutations";
import { defineHandler } from "@/shared/server/handler";

const list = defineHandler({
  auth: tasksAdminAuth(),
  input: z.object({}),
  handler: async ({ eventId }) => listFileRequestsIn(db, eventIdSchema.parse(eventId)),
});

const create = defineHandler({
  auth: tasksAdminAuth({ role: "organizer" }),
  input: saveFileRequestInputSchema,
  handler: async ({ eventId, input }) => saveFileRequestIn(db, eventIdSchema.parse(eventId), input),
});

export function GET(request: NextRequest): Promise<Response> {
  return list(request);
}

export function POST(request: NextRequest): Promise<Response> {
  return create(request);
}
