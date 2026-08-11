import { NextRequest } from "next/server";
import { z } from "zod";
import { completeTaskViaUpload } from "@/features/portal";
import { eventIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";
import { portalQueryAuth, requestWithPathValues, sessionContactId } from "../../../_lib";

export const dynamic = "force-dynamic";

/**
 * A file task, finished. The bytes are already in R2 by the time this is called —
 * M07's presign/finalize pair owns that — so all this records is which asset
 * answers which request, and completes the task in the same transaction.
 */
const upload = defineHandler({
  auth: portalQueryAuth,
  input: z.object({
    taskId: z.uuid(),
    submissionId: z.uuid().nullable().default(null),
    fileAssetId: z.uuid(),
  }),
  handler: async ({ eventId, session, input }) => {
    const upload = await completeTaskViaUpload(
      eventIdSchema.parse(eventId),
      sessionContactId(session),
      input.taskId,
      input.submissionId,
      input.fileAssetId,
    );
    return { completed: true, upload };
  },
});

export async function POST(request: NextRequest, route: { params: Promise<{ taskId: string }> }): Promise<Response> {
  const { taskId } = await route.params;
  return upload(await requestWithPathValues(request, { taskId }));
}
