import type { JobName, JobStats } from "@/shared/contracts";
import { getEnv } from "@/shared/lib/env";
import { captureError } from "@/shared/lib/error-tracking";
import { recordJobSuccess } from "@/shared/server/job-heartbeats";

export type JobResult = { job: JobName; ok: boolean; stats: JobStats; ms: number; error?: string };

// Constant time over the longer input; length mismatch flips the accumulator once.
function safeEqual(a: string, b: string) {
  const length = Math.max(a.length, b.length);
  let mismatch = a.length === b.length ? 0 : 1;
  for (let index = 0; index < length; index += 1) mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return mismatch === 0;
}

export function defineJobRoute(job: JobName, run: () => Promise<JobStats>) {
  async function POST(request: Request) {
    const secret = getEnv().CRON_SECRET;
    const provided = request.headers.get("x-cron-secret") ?? "";
    if (!secret || !provided || !safeEqual(provided, secret)) {
      return Response.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
    }
    const started = Date.now();
    try {
      const stats = await run();
      await recordJobSuccess(job, Date.now() - started);
      const result: JobResult = { job, ok: true, stats, ms: Date.now() - started };
      console.log(JSON.stringify(result));
      return Response.json(result);
    } catch (error) {
      // Same seam as defineHandler's INTERNAL branch (PLAN P3-OPS): capture
      // the raw error before it is flattened to a string for the job log.
      const requestId = request.headers.get("cf-ray") ?? "cron";
      captureError(error, { requestId, feature: "jobs", code: job });
      // The raw message/stack is already in the structured error.captured log.
      // Do not duplicate it into the HTTP body, where the dispatcher would
      // otherwise copy database/provider details into a second log stream.
      const result: JobResult = { job, ok: false, stats: {}, ms: Date.now() - started, error: "Job failed" };
      console.log(JSON.stringify(result));
      return Response.json(result, { status: 500 });
    }
  }
  return { POST };
}
