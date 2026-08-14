export interface Env { APP_BASE_URL: string; CRON_SECRET: string }
type CronController = { scheduledTime: number };
type WorkerContext = { waitUntil(promise: Promise<unknown>): void };
export type JobName = "outbox" | "reminders" | "airtable" | "cleanup";
export type JobFetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

// A tick may dispatch two 50-row outboxes in bounded recipient lanes, so this
// is deliberately longer than one minute. It is still well below the scheduled
// Worker runtime's wall-time ceiling and prevents a stuck sibling Worker
// request from living forever or hiding behind overlapping cron invocations.
export const JOB_FETCH_TIMEOUT_MS = 120_000;

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

/** Dispatch one authenticated job without ever copying its response body into logs. */
export async function dispatchJob(env: Env, job: JobName, fetcher: JobFetcher = fetch): Promise<void> {
  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetcher(`${env.APP_BASE_URL}/api/jobs/${job}`, {
      method: "POST",
      headers: { "x-cron-secret": env.CRON_SECRET },
      signal: AbortSignal.timeout(JOB_FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      msg: "scheduled.job_request_failed",
      job,
      ok: false,
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
    status: response.status,
    durationMs: Date.now() - startedAt,
  }));
}

/**
 * Let every sibling settle, then reject once if any failed. Cloudflare records
 * the first rejected waitUntil promise as the Cron Trigger invocation status,
 * while all other jobs still get their chance to run.
 */
export async function runScheduledJobs(
  env: Env,
  jobs: readonly JobName[],
  fetcher: JobFetcher = fetch,
): Promise<void> {
  const results = await Promise.allSettled(jobs.map((job) => dispatchJob(env, job, fetcher)));
  const failed = jobs.filter((_job, index) => results[index]?.status === "rejected");
  if (failed.length > 0) {
    throw new Error(`Scheduled jobs failed: ${failed.join(", ")}`);
  }
}

const worker = {
  scheduled(controller: CronController, env: Env, ctx: WorkerContext) {
    ctx.waitUntil(runScheduledJobs(env, jobsForScheduledTime(controller.scheduledTime)));
  },
  async fetch() { return new Response("sb-jobs", { status: 200 }); },
};

export default worker;
