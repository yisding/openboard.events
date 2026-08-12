import { afterEach, describe, expect, it, vi } from "vitest";
import worker, {
  dispatchJob,
  JOB_FETCH_TIMEOUT_MS,
  jobsForScheduledTime,
  runScheduledJobs,
  type Env,
  type JobFetcher,
} from "../workers/jobs/index";

const env: Env = {
  APP_BASE_URL: "https://sb-web.example.test",
  CRON_SECRET: "cron-secret",
};

describe("scheduled jobs Worker", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("dispatches authenticated jobs with a bounded request and privacy-safe success log", async () => {
    const info = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const fetcher = vi.fn<JobFetcher>(async () => Response.json({ job: "outbox", secret: "must-not-be-logged" }));

    await dispatchJob(env, "outbox", fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe("https://sb-web.example.test/api/jobs/outbox");
    expect(init?.headers).toEqual({ "x-cron-secret": "cron-secret" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect((init?.signal as AbortSignal).aborted).toBe(false);
    expect(JOB_FETCH_TIMEOUT_MS).toBe(120_000);

    const logged = info.mock.calls.map(([value]) => String(value)).join("\n");
    expect(logged).toContain('"msg":"scheduled.job_complete"');
    expect(logged).not.toContain("must-not-be-logged");
    expect(logged).not.toContain("cron-secret");
  });

  it("rejects a non-success response without logging its raw body", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetcher: JobFetcher = async () => Response.json(
      { error: "postgres://user:password@example.test/private" },
      { status: 500 },
    );

    await expect(dispatchJob(env, "cleanup", fetcher)).rejects.toThrow(
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
    const fetcher: JobFetcher = async (input) => {
      const url = String(input);
      seen.push(url);
      return new Response(null, { status: url.endsWith("/reminders") ? 503 : 200 });
    };

    await expect(runScheduledJobs(env, ["outbox", "reminders", "cleanup"], fetcher))
      .rejects.toThrow("Scheduled jobs failed: reminders");

    expect(seen).toEqual([
      "https://sb-web.example.test/api/jobs/outbox",
      "https://sb-web.example.test/api/jobs/reminders",
      "https://sb-web.example.test/api/jobs/cleanup",
    ]);
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

  it("passes the aggregate promise to waitUntil so a failed job marks the cron invocation failed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500 })));
    let waited: Promise<unknown> | undefined;

    worker.scheduled(
      { scheduledTime: Date.UTC(2026, 7, 11, 9, 1) },
      env,
      { waitUntil(promise) { waited = promise; } },
    );

    expect(waited).toBeDefined();
    await expect(waited).rejects.toThrow("Scheduled jobs failed: outbox");
  });
});
