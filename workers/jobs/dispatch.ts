import type { JobName } from "../../src/shared/contracts/jobs";
import { JOB_REQUEST_TIMEOUT_MS, type JobService } from "../job-service";

export interface Env {
  WEB_JOBS: JobService;
  AIRTABLE_CRON?: string;
  CLEANUP_CRON?: string;
}
export type JobRpc = (job: JobName) => Promise<Response>;

// A tick may dispatch two 50-row outboxes in bounded recipient lanes, so this
// is deliberately longer than one minute. It is still well below the scheduled
// Worker runtime's wall-time ceiling and prevents a stuck sibling Worker
// request from living forever or hiding behind overlapping cron invocations.
export const JOB_FETCH_TIMEOUT_MS = JOB_REQUEST_TIMEOUT_MS;

async function runRpcWithDeadline(rpc: JobRpc, job: JobName): Promise<Response> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Scheduled job ${job} RPC timed out after ${JOB_FETCH_TIMEOUT_MS}ms`));
    }, JOB_FETCH_TIMEOUT_MS);
  });
  try {
    return await Promise.race([rpc(job), deadline]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

export function jobsForScheduledTime(
  scheduledTime: number,
  options?: { airtableCron?: string | undefined; cleanupCron?: string | undefined },
): JobName[] {
  const scheduled = new Date(scheduledTime);
  const minute = scheduled.getUTCMinutes();
  const jobs: JobName[] = ["outbox"];
  if (minute % 15 === 0) jobs.push("reminders");
  // M39 is live: the web-side sweep claims a bounded set of connected events,
  // leases each one, upserts changed records keyed on `Openboard ID`, and
  // reports the remainder it did not reach. It runs five minutes off the
  // quarter hour so it never shares a tick with `reminders`. The flag is read
  // *here* on purpose: with AIRTABLE_CRON unset or "0" nothing is dispatched,
  // so no heartbeat is written and the health endpoint reports the
  // integration as never having run — a flag must not make an unrun
  // integration look like successful scheduled work. Manual "Sync now" is
  // unaffected; it bypasses this dispatcher entirely.
  if (options?.airtableCron === "1" && minute % 15 === 5) jobs.push("airtable");
  // Cleanup is the one sweep whose deletes are irreversible, so after a Neon
  // PITR — when Postgres has moved backward relative to R2's actual contents —
  // an object with no owning row looks exactly like an abandoned staging object
  // and gets swept. `docs/runbooks/backup-restore.md` used to prescribe
  // commenting out this line and redeploying: a source edit, on the worst day,
  // under pressure, by whoever is holding the incident. It is a config flip
  // now.
  //
  // The polarity is the opposite of `AIRTABLE_CRON` on purpose. An integration
  // nobody switched on should stay off, but a retention sweep nobody switched
  // off must keep running: a missing or misspelled variable has to fail toward
  // the sweep still happening, never toward silently accumulating the data this
  // job exists to delete. Only the literal `"0"` disables it.
  if (options?.cleanupCron !== "0" && scheduled.getUTCHours() === 9 && minute === 0) jobs.push("cleanup");
  return jobs;
}

/** Dispatch one job without ever copying its response body into logs. */
export async function dispatchJob(
  env: Env,
  job: JobName,
  options?: { rpc?: JobRpc },
): Promise<void> {
  const startedAt = Date.now();
  let response: Response;
  try {
    response = await runRpcWithDeadline(
      options?.rpc ?? ((name) => env.WEB_JOBS.runJob(name)),
      job,
    );
    if (!(response instanceof Response)) throw new Error("job RPC returned an invalid response");
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      msg: "scheduled.job_request_failed",
      job,
      ok: false,
      transport: "rpc",
      error: error instanceof Error ? error.message : "unknown request failure",
      durationMs: Date.now() - startedAt,
    }));
    throw error;
  }

  if (!response.ok) {
    // The private web runner records the raw failure through captureError.
    // Keep this dispatcher's log privacy-safe and correlated by job/status only.
    console.error(JSON.stringify({
      level: "error",
      msg: "scheduled.job_failed",
      job,
      ok: false,
      transport: "rpc",
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
    transport: "rpc",
    status: response.status,
    durationMs: Date.now() - startedAt,
  }));
}

/** Let every sibling settle before rejecting once if any failed. */
export async function runScheduledJobs(
  env: Env,
  jobs: readonly JobName[],
  options?: { rpc?: JobRpc },
): Promise<void> {
  const results = await Promise.allSettled(jobs.map((job) => dispatchJob(env, job, options)));
  const failed = jobs.filter((_job, index) => results[index]?.status === "rejected");
  if (failed.length > 0) {
    throw new Error(`Scheduled jobs failed: ${failed.join(", ")}`);
  }
}
