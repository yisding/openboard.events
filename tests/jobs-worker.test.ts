import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dispatchJob,
  JOB_FETCH_TIMEOUT_MS,
  jobsForScheduledTime,
  runScheduledJobs,
  type Env,
  type JobRpc,
} from "../workers/jobs/dispatch";
import worker from "../workers/jobs/index";
import {
  blockPrivateJobRoutes,
  isJobName,
  privateJobRequest,
  runPrivateJob,
} from "../workers/job-service";

const env: Env = {
  WEB_JOBS: { runJob: async () => new Response(null, { status: 200 }) },
};

describe("scheduled jobs Worker", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("keeps the Worker main module free of accidental named runtime entrypoints", () => {
    const source = readFileSync(new URL("../workers/jobs/index.ts", import.meta.url), "utf8");
    // workerd interprets every named runtime export from a Worker main module
    // as an entrypoint. Constants make startup fail; helper functions widen RPC.
    expect(source).not.toMatch(/^\s*export\s+(?!default\b|type\b|interface\b)/mu);
  });

  it("dispatches through the private binding with a privacy-safe success log", async () => {
    const info = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const rpc = vi.fn<JobRpc>(async () => Response.json({ job: "outbox", secret: "must-not-be-logged" }));

    await dispatchJob(env, "outbox", { rpc });

    expect(rpc).toHaveBeenCalledWith("outbox");
    expect(JOB_FETCH_TIMEOUT_MS).toBe(120_000);

    const logged = info.mock.calls.map(([value]) => String(value)).join("\n");
    expect(logged).toContain('"msg":"scheduled.job_complete"');
    expect(logged).toContain('"transport":"rpc"');
    expect(logged).not.toContain("must-not-be-logged");
  });

  it("has no public callback or compatibility transport path", () => {
    const dispatchSource = readFileSync(new URL("../workers/jobs/dispatch.ts", import.meta.url), "utf8");
    const configSource = readFileSync(new URL("../workers/jobs/wrangler.jsonc", import.meta.url), "utf8");
    expect(dispatchSource).not.toContain("fetch(");
    expect(dispatchSource).not.toContain("public-compat");
    expect(configSource).not.toContain("global_fetch_strictly_public");
    expect(configSource).not.toContain("JOB_TRANSPORT");
    for (const job of ["outbox", "reminders", "cleanup", "r2-migration"]) {
      expect(existsSync(new URL(`../src/app/api/jobs/${job}/route.ts`, import.meta.url))).toBe(false);
    }
    expect(existsSync(new URL("../src/app/worker-jobs/r2-migration/route.ts", import.meta.url))).toBe(false);
  });

  it("propagates an RPC exception without another dispatch path", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rpc = vi.fn<JobRpc>(async () => { throw new Error("connection lost after invocation"); });

    await expect(dispatchJob(env, "outbox", { rpc })).rejects.toThrow(
      "connection lost after invocation",
    );
  });

  it("bounds the RPC promise even when the web handler ignores its request signal", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const pending = new Promise<Response>((resolve) => { void resolve; });
    const rpc = vi.fn<JobRpc>(() => pending);

    const dispatched = dispatchJob(env, "cleanup", { rpc });
    const rejection = expect(dispatched).rejects.toThrow(
      `Scheduled job cleanup RPC timed out after ${JOB_FETCH_TIMEOUT_MS}ms`,
    );
    await vi.advanceTimersByTimeAsync(JOB_FETCH_TIMEOUT_MS);
    await rejection;
  });

  it("rejects a non-success response without logging its raw body", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rpc: JobRpc = async () => Response.json(
      { error: "postgres://user:password@example.test/private" },
      { status: 500 },
    );

    await expect(dispatchJob(env, "cleanup", { rpc })).rejects.toThrow(
      "Scheduled job cleanup returned HTTP 500",
    );

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
    expect(["outbox", "reminders", "cleanup"].every(isJobName)).toBe(true);
    expect(isJobName("r2-migration")).toBe(false);
    expect(isJobName("airtable")).toBe(false);
    expect(isJobName("billing")).toBe(false);
  });

  it("validates the named entrypoint input before invoking a job", async () => {
    const runner = vi.fn(async () => new Response(null, { status: 202 }));
    const accepted = await runPrivateJob("reminders", runner);
    expect(accepted.status).toBe(202);
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner).toHaveBeenCalledWith("reminders");

    const rejected = await runPrivateJob("billing", runner);
    expect(rejected.status).toBe(400);
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("builds the in-isolate request from the web origin", () => {
    const request = privateJobRequest("https://sb-web-preview.example.test", "cleanup");
    expect(request.url)
      .toBe("https://sb-web-preview.example.test/worker-jobs/cleanup");
    expect(request.method).toBe("POST");
    expect(request.headers.get("x-openboard-private-job")).toBe("JobsEntrypoint");
    expect(privateJobRequest(undefined, "outbox").url)
      .toBe("http://localhost:3000/worker-jobs/outbox");
  });

  it("blocks every private job path on the default web entrypoint", async () => {
    const rawFetch = vi.fn(async () => new Response("public", { status: 200 }));
    const handler = blockPrivateJobRoutes({ fetch: rawFetch });

    const blocked = await handler.fetch(
      new Request("https://example.test/worker-jobs/outbox", {
        headers: { "x-openboard-private-job": "JobsEntrypoint" },
      }),
      env,
      {},
    );
    expect(blocked.status).toBe(404);
    expect(rawFetch).not.toHaveBeenCalled();

    const publicResponse = await handler.fetch(new Request("https://example.test/api/health"), env, {});
    expect(publicResponse.status).toBe(200);
    expect(rawFetch).toHaveBeenCalledTimes(1);
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
