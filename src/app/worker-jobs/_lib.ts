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

/** Carries what the tick still managed to do, plus every sweep that did not. */
export class JobSweepError extends Error {
  constructor(
    readonly failures: readonly { name: string; reason: unknown }[],
    readonly partialStats: JobStats,
  ) {
    super(`Job sweeps failed: ${failures.map((failure) => failure.name).join(", ")}`);
    this.name = "JobSweepError";
  }
}

/**
 * Runs a tick's independent sweeps concurrently and keeps every one of them
 * accountable, the same discipline `workers/jobs/dispatch.ts` already applies
 * one level up.
 *
 * `Promise.all` rejects on the first failure, which discarded the stats of
 * every sibling that had already succeeded and named only the one that threw —
 * so a tick that pruned 400 rows and failed one sweep reported nothing at all,
 * and `recordJobSuccess` was skipped for work that genuinely happened.
 */
export async function settledJobStats(
  sweeps: readonly { name: string; run: () => Promise<JobStats> }[],
): Promise<JobStats> {
  const results = await Promise.allSettled(sweeps.map((sweep) => sweep.run()));
  const stats: JobStats = {};
  const failures: { name: string; reason: unknown }[] = [];
  for (const [index, result] of results.entries()) {
    const name = sweeps[index]?.name ?? String(index);
    if (result.status === "fulfilled") Object.assign(stats, result.value);
    else failures.push({ name, reason: result.reason });
  }
  if (failures.length > 0) throw new JobSweepError(failures, stats);
  return stats;
}

/**
 * Did this tick do work a heartbeat should vouch for?
 *
 * A sweep gated off by a flag returns `{ …SkippedDisabled: 1 }` and nothing
 * else. Recording that as a success writes `last_succeeded_at`, and
 * `/api/health` then reports a small `…LastSuccessAgeSeconds` for an
 * integration that has never run — precisely the "a flag must not make an
 * unrun integration look like successful scheduled work" failure the dispatcher
 * gate exists to prevent, reachable by hand-curling the private route that
 * `workers/jobs/README.md` documents. A tick with no stats at all is ordinary
 * (nothing was due) and still counts.
 */
function isHeartbeatWorthy(stats: JobStats): boolean {
  const keys = Object.keys(stats);
  return keys.length === 0 || !keys.every((key) => key.endsWith("SkippedDisabled"));
}

export function definePrivateJobRoute(job: JobName, run: () => Promise<JobStats>) {
  async function POST(request: Request) {
    if (request.headers.get(PRIVATE_JOB_HEADER) !== PRIVATE_JOB_HEADER_VALUE) {
      return new Response("Not Found", { status: 404 });
    }
    const started = Date.now();
    const requestId = request.headers.get("cf-ray") ?? `rpc:${crypto.randomUUID()}`;
    try {
      const stats = await run();
      if (isHeartbeatWorthy(stats)) await recordJobSuccess(job, Date.now() - started);
      const result: JobResult = { job, ok: true, stats, ms: Date.now() - started };
      log({ level: "info", msg: "job.complete", requestId, feature: "jobs", code: job, durationMs: result.ms, stats });
      return Response.json(result);
    } catch (error) {
      // One capture per failed sweep, each with its own message and stack —
      // a single capture of the summary would name the sweeps and explain
      // none of them.
      const failures = error instanceof JobSweepError
        ? error.failures.map((failure) => ({ reason: failure.reason, code: `${job}.${failure.name}` }))
        : [{ reason: error, code: job as string }];
      for (const failure of failures) {
        captureError(failure.reason, { requestId, feature: "jobs", code: failure.code });
      }
      const result: JobResult = {
        job,
        ok: false,
        // What the tick did accomplish before a sibling failed, rather than a
        // blank slate that reads as "nothing ran".
        stats: error instanceof JobSweepError ? error.partialStats : {},
        ms: Date.now() - started,
        error: "Job failed",
      };
      // `captureError` carries the real message and stack but has no duration
      // field, so the tick's timing would otherwise be lost on the failure path.
      log({ level: "error", msg: "job.failed", requestId, feature: "jobs", code: job, durationMs: result.ms, stats: result.stats });
      return Response.json(result, { status: 500 });
    }
  }
  return { POST };
}
