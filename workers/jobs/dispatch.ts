import type { JobName } from "../../src/shared/contracts/jobs";
import {
  JOB_REQUEST_TIMEOUT_MS,
  privateJobRequest,
  type JobService,
} from "../job-service";

export interface Env { APP_BASE_URL: string; CRON_SECRET: string; WEB_JOBS: JobService }
export type JobFetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export type JobRpc = (job: JobName) => Promise<Response>;

// A tick may dispatch two 50-row outboxes in bounded recipient lanes, so this
// is deliberately longer than one minute. It is still well below the scheduled
// Worker runtime's wall-time ceiling and prevents a stuck sibling Worker
// request from living forever or hiding behind overlapping cron invocations.
export const JOB_FETCH_TIMEOUT_MS = JOB_REQUEST_TIMEOUT_MS;

export function jobsForScheduledTime(scheduledTime: number): JobName[] {
  const scheduled = new Date(scheduledTime);
  const minute = scheduled.getUTCMinutes();
  const jobs: JobName[] = ["outbox"];
  if (minute % 15 === 0) jobs.push("reminders");
  // Airtable is a deferred bonus with no production implementation. Do not
  // make a stub look like successful scheduled work; add it here only when
  // the real idempotent sync and its production acceptance proof exist.
  if (scheduled.getUTCHours() === 9 && minute === 0) jobs.push("cleanup");
  return jobs;
}

/** Dispatch one job without ever copying its response body into logs. */
export async function dispatchJob(
  env: Env,
  job: JobName,
  options?: { rpc?: JobRpc; fetcher?: JobFetcher },
): Promise<void> {
  const startedAt = Date.now();
  let response: Response;
  let transport: "rpc" | "public-fallback" = "rpc";
  try {
    try {
      response = await (options?.rpc ?? ((name) => env.WEB_JOBS.runJob(name)))(job);
      if (!(response instanceof Response)) throw new Error("job RPC returned an invalid response");
    } catch {
      // One compatibility release keeps the authenticated HTTP callback as a
      // rollback adapter. Never retry a valid 500 response: the private request
      // reached the job and replaying it here could duplicate side effects.
      transport = "public-fallback";
      console.warn(JSON.stringify({
        level: "warn",
        msg: "scheduled.job_rpc_unavailable",
        job,
        transport,
      }));
      response = await (options?.fetcher ?? fetch)(privateJobRequest(env, job));
    }
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      msg: "scheduled.job_request_failed",
      job,
      ok: false,
      transport,
      error: error instanceof Error ? error.message : "unknown request failure",
      durationMs: Date.now() - startedAt,
    }));
    throw error;
  }

  if (!response.ok) {
    // The authenticated web route records the raw failure through captureError.
    // Keep this dispatcher's log privacy-safe and correlated by job/status only.
    console.error(JSON.stringify({
      level: "error",
      msg: "scheduled.job_failed",
      job,
      ok: false,
      transport,
      status: response.status,
      durationMs: Date.now() - startedAt,
    }));
    throw new Error(`Scheduled job ${job} returned HTTP ${response.status}`);
  }

  console.log(JSON.stringify({
    level: "info",
    msg: "scheduled.job_complete",
    job,
    ok: true,
    transport,
    status: response.status,
    durationMs: Date.now() - startedAt,
  }));
}

/** Let every sibling settle before rejecting once if any failed. */
export async function runScheduledJobs(
  env: Env,
  jobs: readonly JobName[],
  options?: { rpc?: JobRpc; fetcher?: JobFetcher },
): Promise<void> {
  const results = await Promise.allSettled(jobs.map((job) => dispatchJob(env, job, options)));
  const failed = jobs.filter((_job, index) => results[index]?.status === "rejected");
  if (failed.length > 0) {
    throw new Error(`Scheduled jobs failed: ${failed.join(", ")}`);
  }
}
