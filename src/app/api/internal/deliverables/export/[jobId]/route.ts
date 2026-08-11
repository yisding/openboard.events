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
 * Polled by the Files view's export progress UI (every ~1.5s while the job
 * isn't terminal). A job still `pending` or `processing` here is advanced by
 * exactly one bounded step before responding — the same unit
 * `processFileExportJobIn` always does, whether or not that step happens to
 * finish the job. This doubles as the resumption mechanism for a job too
 * large for one step: the POST route's `waitUntil` runs the *first* step,
 * and every poll after that runs the next one, converging in as many polls
 * as the job has steps rather than in one call.
 * `processFileExportJob`'s own claim (a short lease, not a one-shot
 * `WHERE status = 'pending'`) is what keeps two concurrent pollers from
 * double-processing the same step.
 */
const get = defineHandler({
  auth: tasksAdminAuth(),
  input: z.object({}),
  handler: async ({ eventId, params }) => {
    const { jobId } = paramsSchema.parse(params);
    const scopedEventId = eventIdSchema.parse(eventId);
    const job = await getFileExportJob(scopedEventId, jobId);
    if (!job) throw new AppError("NOT_FOUND", "Export job not found");
    if (job.status === "completed" || job.status === "failed") return job;
    await processFileExportJob(scopedEventId, jobId);
    const settled = await getFileExportJob(scopedEventId, jobId);
    if (!settled) throw new AppError("NOT_FOUND", "Export job not found");
    return settled;
  },
});

export function GET(request: NextRequest, route: { params: Promise<{ jobId: string }> }): Promise<Response> {
  return get(request, route);
}
