import type { NextRequest } from "next/server";
import { z } from "zod";
import { listFileVersions } from "@/features/portal";
import { tasksAdminAuth } from "@/features/portal/tasks-admin/server/queries";
import { contactIdSchema, eventIdSchema, fileRequestIdSchema, submissionIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

/** A deliverable slot's numbered version history, organizer side (M52). */
const list = defineHandler({
  auth: tasksAdminAuth(),
  input: z.object({
    fileRequestId: fileRequestIdSchema,
    contactId: contactIdSchema,
    submissionId: submissionIdSchema.nullable().default(null),
  }),
  handler: async ({ eventId, input }) => listFileVersions(eventIdSchema.parse(eventId), input.fileRequestId, input.contactId, input.submissionId),
});

export function GET(request: NextRequest): Promise<Response> {
  return list(request);
}
