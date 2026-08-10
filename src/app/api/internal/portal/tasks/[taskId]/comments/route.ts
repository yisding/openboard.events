import { NextRequest } from "next/server";
import { z } from "zod";
import { addTaskComment } from "@/features/portal";
import { eventIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";
import { portalQueryAuth, requestWithPathValues, sessionContactId } from "../../../_lib";

export const dynamic = "force-dynamic";

/** A speaker's comment on their own file-request deliverable (M52). */
const create = defineHandler({
  auth: portalQueryAuth,
  input: z.object({
    taskId: z.uuid(),
    submissionId: z.uuid().nullable().default(null),
    body: z.string().trim().min(1).max(5_000),
  }),
  handler: async ({ eventId, session, input }) => addTaskComment(
    eventIdSchema.parse(eventId),
    sessionContactId(session),
    input.taskId,
    input.submissionId,
    input.body,
  ),
});

export async function POST(request: NextRequest, route: { params: Promise<{ taskId: string }> }): Promise<Response> {
  const { taskId } = await route.params;
  return create(await requestWithPathValues(request, { taskId }));
}
