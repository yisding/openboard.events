import { NextRequest } from "next/server";
import { z } from "zod";
import { completeTaskManual, completeTaskViaResponse, getMyTask } from "@/features/portal";
import { revalidatePublicEvent } from "@/features/public/server/revalidate";
import { eventIdSchema } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { defineHandler } from "@/shared/server/handler";
import { portalQueryAuth, requestWithPathValues, sessionContactId } from "../../../_lib";

export const dynamic = "force-dynamic";

/**
 * Finishing a task that is not a file upload. The route dispatches on the task's
 * own `completion_mode` rather than trusting the caller to say which kind it is —
 * the client cannot turn a form task into a one-click manual one by posting to a
 * different shape.
 */
const complete = defineHandler({
  auth: portalQueryAuth,
  input: z.object({
    taskId: z.uuid(),
    submissionId: z.uuid().nullable().default(null),
    answers: z.record(z.string(), z.unknown()).default({}),
  }),
  handler: async ({ eventId, session, input, requestId }) => {
    const event = eventIdSchema.parse(eventId);
    const contactId = sessionContactId(session);
    const task = await getMyTask(event, contactId, input.taskId, input.submissionId);
    // A task belonging to another speaker reads exactly like one that is not there.
    if (!task) throw new AppError("NOT_FOUND", "Task not found");

    if (task.completionMode === "manual") {
      await completeTaskManual(event, contactId, input.taskId, input.submissionId);
    } else if (task.completionMode === "form") {
      await completeTaskViaResponse(event, contactId, input.taskId, input.submissionId, input.answers);
      await revalidatePublicEvent(event, ["schedule", "speakers"], requestId);
    } else {
      throw new AppError("VALIDATION", "This task is completed by uploading a file");
    }
    return { completed: true };
  },
});

export async function POST(request: NextRequest, route: { params: Promise<{ taskId: string }> }): Promise<Response> {
  const { taskId } = await route.params;
  return complete(await requestWithPathValues(request, { taskId }));
}
