import type { NextRequest } from "next/server";
import { z } from "zod";
import { getFileExportJob, processFileExportJob } from "@/features/portal/deliverables";
import { tasksAdminAuth } from "@/features/portal/tasks-admin/server/queries";
import { eventIdSchema } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({ jobId: z.uuid() });

/**
 * Polled by the Files view's export progress UI. A job still `pending` here
 * is processed inline before responding — the fallback for `next dev` and
 * tests, which have no Worker `waitUntil` to have already run it; on the
 * deployed preview this is normally a no-op because the POST route's
 * `waitUntil` already finished by the time a client's first poll lands.
 * `processFileExportJob`'s own claim (`UPDATE … WHERE status = 'pending'`)
 * is what keeps two concurrent pollers from double-processing the same job.
 */
const get = defineHandler({
  auth: tasksAdminAuth(),
  input: z.object({}),
  handler: async ({ eventId, params }) => {
    const { jobId } = paramsSchema.parse(params);
    const scopedEventId = eventIdSchema.parse(eventId);
    const job = await getFileExportJob(scopedEventId, jobId);
    if (!job) throw new AppError("NOT_FOUND", "Export job not found");
    if (job.status !== "pending") return job;
    await processFileExportJob(scopedEventId, jobId);
    const settled = await getFileExportJob(scopedEventId, jobId);
    if (!settled) throw new AppError("NOT_FOUND", "Export job not found");
    return settled;
  },
});

export function GET(request: NextRequest, route: { params: Promise<{ jobId: string }> }): Promise<Response> {
  return get(request, route);
}
