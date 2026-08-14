import {
  PRIVATE_JOB_HEADER,
  PRIVATE_JOB_HEADER_VALUE,
  type JobName,
  type JobStats,
} from "@/shared/contracts";
import { captureError } from "@/shared/lib/error-tracking";
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
    try {
      const stats = await run();
      await recordJobSuccess(job, Date.now() - started);
      const result: JobResult = { job, ok: true, stats, ms: Date.now() - started };
      console.log(JSON.stringify(result));
      return Response.json(result);
    } catch (error) {
      captureError(error, {
        requestId: request.headers.get("cf-ray") ?? `rpc:${crypto.randomUUID()}`,
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
      console.log(JSON.stringify(result));
      return Response.json(result, { status: 500 });
    }
  }
  return { POST };
}
