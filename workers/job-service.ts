import {
  PRIVATE_JOB_HEADER,
  PRIVATE_JOB_HEADER_VALUE,
  PRIVATE_JOB_PATH_PREFIX,
  type JobName,
} from "../src/shared/contracts/jobs";

export const JOB_REQUEST_TIMEOUT_MS = 120_000;

export interface JobService {
  runJob(job: JobName): Promise<Response>;
}

export interface JobRouteHandler<Env, Context> {
  fetch(request: Request, env: Env, context: Context): Promise<Response>;
}

const JOB_NAMES = new Set<JobName>(["outbox", "reminders", "cleanup", "airtable"]);

export function isJobName(value: unknown): value is JobName {
  return typeof value === "string" && JOB_NAMES.has(value as JobName);
}

/** Build the in-isolate request consumed only by the raw OpenNext handler. */
export function privateJobRequest(appBaseUrl: unknown, job: JobName): Request {
  const origin = typeof appBaseUrl === "string" ? appBaseUrl : "http://localhost:3000";
  return new Request(new URL(`${PRIVATE_JOB_PATH_PREFIX}${job}`, origin), {
    method: "POST",
    headers: { [PRIVATE_JOB_HEADER]: PRIVATE_JOB_HEADER_VALUE },
  });
}

export function isPrivateJobPath(request: Request): boolean {
  return new URL(request.url).pathname.startsWith(PRIVATE_JOB_PATH_PREFIX);
}

/** The default/public Worker entrypoint never forwards private job paths. */
export function blockPrivateJobRoutes<Env, Context>(
  handler: JobRouteHandler<Env, Context>,
): JobRouteHandler<Env, Context> {
  return {
    fetch(request, env, context) {
      if (isPrivateJobPath(request)) return Promise.resolve(new Response("Not Found", { status: 404 }));
      return handler.fetch(request, env, context);
    },
  };
}

export async function runPrivateJob(
  job: unknown,
  run: (job: JobName) => Promise<Response>,
): Promise<Response> {
  if (!isJobName(job)) {
    return Response.json({ error: { code: "VALIDATION" } }, { status: 400 });
  }
  return run(job);
}
