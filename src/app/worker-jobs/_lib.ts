import {
  PRIVATE_JOB_HEADER,
  PRIVATE_JOB_HEADER_VALUE,
  type JobName,
  type JobStats,
} from "@/shared/contracts";
import { captureError } from "@/shared/lib/error-tracking";
import { log } from "@/shared/lib/log";
import { recordJobSuccess } from "@/shared/server/job-heartbeats";

export type JobResult = {
  job: JobName;
  ok: boolean;
  stats: JobStats;
  ms: number;
  error?: string;
};

export function definePrivateJobRoute(job: JobName, run: () => Promise<JobStats>) {
  async function POST(request: Request) {
    if (request.headers.get(PRIVATE_JOB_HEADER) !== PRIVATE_JOB_HEADER_VALUE) {
      return new Response("Not Found", { status: 404 });
    }
    const started = Date.now();
    const requestId = request.headers.get("cf-ray") ?? `rpc:${crypto.randomUUID()}`;
    try {
      const stats = await run();
      await recordJobSuccess(job, Date.now() - started);
      const result: JobResult = { job, ok: true, stats, ms: Date.now() - started };
      log({ level: "info", msg: "job.complete", requestId, feature: "jobs", code: job, durationMs: result.ms, stats });
      return Response.json(result);
    } catch (error) {
      captureError(error, {
        requestId,
        feature: "jobs",
        code: job,
      });
      const result: JobResult = {
        job,
        ok: false,
        stats: {},
        ms: Date.now() - started,
        error: "Job failed",
      };
      // The failure itself is already on the wire through `captureError` above,
      // with the real message and stack; a second line would only repeat the
      // sanitized response body.
      return Response.json(result, { status: 500 });
    }
  }
  return { POST };
}
