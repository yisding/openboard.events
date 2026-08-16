import { NextRequest } from "next/server";
import { z } from "zod";
import { finalizeAndCompleteTaskUpload } from "@/features/portal";
import { eventIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";
import { portalQueryAuth, requestWithPathValues, sessionContactId, sessionImpersonatedByUserId } from "../../../_lib";

export const dynamic = "force-dynamic";

/**
 * A file task, finished. The bytes are in R2's `staging/` prefix by the time this
 * is called — M07's presigned PUT put them there — and this is the request that
 * publishes them *and* records which asset answers which request. The speaker
 * makes one call, not two: a second, separate `/api/uploads/finalize` round trip
 * is what used to leave a published file attached to nothing when the network
 * dropped between them (#621).
 */
const upload = defineHandler({
  auth: portalQueryAuth,
  input: z.object({
    taskId: z.uuid(),
    submissionId: z.uuid().nullable().default(null),
    fileAssetId: z.uuid(),
  }),
  handler: async ({ eventId, session, input }) => {
    const upload = await finalizeAndCompleteTaskUpload(
      eventIdSchema.parse(eventId),
      sessionContactId(session),
      input.taskId,
      input.submissionId,
      input.fileAssetId,
      // Same attribution as the non-upload completion route: an organizer
      // sending the file from inside "Open portal as …" is who this
      // completion stands on.
      sessionImpersonatedByUserId(session),
    );
    return { completed: true, upload };
  },
});

export async function POST(request: NextRequest, route: { params: Promise<{ taskId: string }> }): Promise<Response> {
  const { taskId } = await route.params;
  return upload(await requestWithPathValues(request, { taskId }));
}
