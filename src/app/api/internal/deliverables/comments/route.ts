import type { NextRequest } from "next/server";
import { z } from "zod";
import { listFileComments } from "@/features/portal";
import { addOrganizerComment, organizerCommentInputSchema } from "@/features/portal/deliverables/server/mutations";
import { tasksAdminAuth } from "@/features/portal/tasks-admin/server/queries";
import { contactIdSchema, eventIdSchema, fileRequestIdSchema, submissionIdSchema, userIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

/** A deliverable slot's comment thread, organizer side (M52). */
const list = defineHandler({
  auth: tasksAdminAuth(),
  input: z.object({
    fileRequestId: fileRequestIdSchema,
    contactId: contactIdSchema,
    submissionId: submissionIdSchema.nullable().default(null),
  }),
  handler: async ({ eventId, input }) => listFileComments(eventIdSchema.parse(eventId), input.fileRequestId, input.contactId, input.submissionId),
});

/** The organizer's half of a deliverable's comment thread. */
const create = defineHandler({
  auth: tasksAdminAuth({ role: "organizer" }),
  input: organizerCommentInputSchema,
  handler: async ({ eventId, session, input }) => addOrganizerComment(
    eventIdSchema.parse(eventId),
    userIdSchema.parse(session?.actorId),
    input,
  ),
});

export function GET(request: NextRequest): Promise<Response> {
  return list(request);
}

export function POST(request: NextRequest): Promise<Response> {
  return create(request);
}
