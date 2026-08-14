import type { JobName } from "../src/shared/contracts/jobs";

export const JOB_REQUEST_TIMEOUT_MS = 120_000;

export interface JobService {
  runJob(job: JobName): Promise<Response>;
}

export interface JobRouteHandler<Env, Context> {
  fetch(request: Request, env: Env, context: Context): Promise<Response>;
}

export type PrivateJobEnv = {
  APP_BASE_URL: string;
  CRON_SECRET: string;
};

const JOB_NAMES = new Set<JobName>(["outbox", "reminders", "airtable", "cleanup"]);

export function isJobName(value: unknown): value is JobName {
  return typeof value === "string" && JOB_NAMES.has(value as JobName);
}

export function privateJobRequest(env: PrivateJobEnv, job: JobName): Request {
  return new Request(`${env.APP_BASE_URL}/api/jobs/${job}`, {
    method: "POST",
    headers: { "x-cron-secret": env.CRON_SECRET },
    signal: AbortSignal.timeout(JOB_REQUEST_TIMEOUT_MS),
  });
}

export async function runPrivateJob<Env extends PrivateJobEnv, Context>(
  handler: JobRouteHandler<Env, Context>,
  env: Env,
  context: Context,
  job: unknown,
): Promise<Response> {
  if (!isJobName(job)) {
    return Response.json({ error: { code: "VALIDATION" } }, { status: 400 });
  }
  return handler.fetch(privateJobRequest(env, job), env, context);
}
