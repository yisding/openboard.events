import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dispatchJob,
  JOB_FETCH_TIMEOUT_MS,
  jobsForScheduledTime,
  runScheduledJobs,
  type Env,
  type JobFetcher,
  type JobRpc,
} from "../workers/jobs/dispatch";
import worker from "../workers/jobs/index";
import { isJobName, runPrivateJob } from "../workers/job-service";

const env: Env = {
  APP_BASE_URL: "https://sb-web.example.test",
  CRON_SECRET: "cron-secret",
  WEB_JOBS: { runJob: async () => new Response(null, { status: 200 }) },
};

describe("scheduled jobs Worker", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps the Worker main module free of accidental named runtime entrypoints", () => {
    const source = readFileSync(new URL("../workers/jobs/index.ts", import.meta.url), "utf8");
    // workerd interprets every named runtime export from a Worker main module
    // as an entrypoint. Constants make startup fail; helper functions widen RPC.
    expect(source).not.toMatch(/^\s*export\s+(?!default\b|type\b|interface\b)/mu);
  });

  it("dispatches through the private binding with a privacy-safe success log", async () => {
    const info = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const fetcher = vi.fn<JobFetcher>();
    const rpc = vi.fn<JobRpc>(async () => Response.json({ job: "outbox", secret: "must-not-be-logged" }));

    await dispatchJob(env, "outbox", { rpc, fetcher });

    expect(rpc).toHaveBeenCalledWith("outbox");
    expect(fetcher).not.toHaveBeenCalled();
    expect(JOB_FETCH_TIMEOUT_MS).toBe(120_000);

    const logged = info.mock.calls.map(([value]) => String(value)).join("\n");
    expect(logged).toContain('"msg":"scheduled.job_complete"');
    expect(logged).toContain('"transport":"rpc"');
    expect(logged).not.toContain("must-not-be-logged");
    expect(logged).not.toContain("cron-secret");
  });

  it("uses the authenticated public callback only when RPC is unavailable", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const rpc = vi.fn<JobRpc>(async () => { throw new Error("entrypoint is not deployed"); });
    const fetcher = vi.fn<JobFetcher>(async () => new Response(null, { status: 200 }));

    await dispatchJob(env, "outbox", { rpc, fetcher });

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [request] = fetcher.mock.calls[0] ?? [];
    expect(request).toBeInstanceOf(Request);
    expect((request as Request).url).toBe("https://sb-web.example.test/api/jobs/outbox");
    expect((request as Request).headers.get("x-cron-secret")).toBe("cron-secret");
    expect((request as Request).signal.aborted).toBe(false);
    const logged = warning.mock.calls.map(([value]) => String(value)).join("\n");
    expect(logged).toContain('"transport":"public-fallback"');
    expect(logged).not.toContain("entrypoint is not deployed");
    expect(logged).not.toContain("cron-secret");
  });

  it("rejects a non-success response without logging its raw body", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetcher = vi.fn<JobFetcher>();
    const rpc: JobRpc = async () => Response.json(
      { error: "postgres://user:password@example.test/private" },
      { status: 500 },
    );

    await expect(dispatchJob(env, "cleanup", { rpc, fetcher })).rejects.toThrow(
      "Scheduled job cleanup returned HTTP 500",
    );
    expect(fetcher).not.toHaveBeenCalled();

    const logged = error.mock.calls.map(([value]) => String(value)).join("\n");
    expect(logged).toContain('"msg":"scheduled.job_failed"');
    expect(logged).toContain('"status":500');
    expect(logged).not.toContain("password");
  });

  it("runs every sibling and rejects the aggregate when any job fails", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const seen: string[] = [];
    const rpc: JobRpc = async (job) => {
      seen.push(job);
      return new Response(null, { status: job === "reminders" ? 503 : 200 });
    };

    await expect(runScheduledJobs(env, ["outbox", "reminders", "cleanup"], { rpc }))
      .rejects.toThrow("Scheduled jobs failed: reminders");

    expect(seen).toEqual(["outbox", "reminders", "cleanup"]);
  });

  it("keeps the documented UTC cadence", () => {
    expect(jobsForScheduledTime(Date.UTC(2026, 7, 11, 9, 0))).toEqual([
      "outbox",
      "reminders",
      "cleanup",
    ]);
    expect(jobsForScheduledTime(Date.UTC(2026, 7, 11, 9, 5))).toEqual(["outbox"]);
    expect(jobsForScheduledTime(Date.UTC(2026, 7, 11, 9, 1))).toEqual(["outbox"]);
  });

  it("exposes only the closed scheduled-job contract to the RPC entrypoint", () => {
    expect(["outbox", "reminders", "airtable", "cleanup"].every(isJobName)).toBe(true);
    expect(isJobName("billing")).toBe(false);
  });

  it("validates the named entrypoint input before invoking the web handler", async () => {
    const context = { marker: "execution-context" };
    const fetchHandler = vi.fn<(
      request: Request,
      handlerEnv: Env,
      handlerContext: typeof context,
    ) => Promise<Response>>(async () => new Response(null, { status: 202 }));
    const handler = { fetch: fetchHandler };

    const accepted = await runPrivateJob(handler, env, context, "reminders");
    expect(accepted.status).toBe(202);
    expect(fetchHandler).toHaveBeenCalledTimes(1);
    const [request, passedEnv, passedContext] = fetchHandler.mock.calls[0] ?? [];
    expect(request).toBeInstanceOf(Request);
    expect((request as Request).url).toBe("https://sb-web.example.test/api/jobs/reminders");
    expect(passedEnv).toBe(env);
    expect(passedContext).toBe(context);

    const rejected = await runPrivateJob(handler, env, context, "billing");
    expect(rejected.status).toBe(400);
    expect(fetchHandler).toHaveBeenCalledTimes(1);
  });

  it("passes the aggregate promise to waitUntil so a failed job marks the cron invocation failed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failedEnv: Env = {
      ...env,
      WEB_JOBS: { runJob: async () => new Response(null, { status: 500 }) },
    };
    let waited: Promise<unknown> | undefined;

    worker.scheduled(
      { scheduledTime: Date.UTC(2026, 7, 11, 9, 1) },
      failedEnv,
      { waitUntil(promise) { waited = promise; } },
    );

    expect(waited).toBeDefined();
    await expect(waited).rejects.toThrow("Scheduled jobs failed: outbox");
  });
});
