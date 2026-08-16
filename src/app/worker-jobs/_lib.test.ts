import { beforeEach, describe, expect, it, vi } from "vitest";
import { PRIVATE_JOB_HEADER, PRIVATE_JOB_HEADER_VALUE } from "@/shared/contracts";

vi.mock("@/shared/lib/error-tracking", () => ({ captureError: vi.fn() }));
vi.mock("@/shared/server/job-heartbeats", () => ({ recordJobSuccess: vi.fn() }));

const { captureError } = await import("@/shared/lib/error-tracking");
const { recordJobSuccess } = await import("@/shared/server/job-heartbeats");
const { definePrivateJobRoute, settledJobStats } = await import("./_lib");

function request(privateInvocation = true): Request {
  return new Request("https://example.test/worker-jobs/cleanup", {
    method: "POST",
    headers: privateInvocation ? { [PRIVATE_JOB_HEADER]: PRIVATE_JOB_HEADER_VALUE } : {},
  });
}

describe("private job adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(recordJobSuccess).mockResolvedValue(undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  it("fails closed without the entrypoint marker", async () => {
    const run = vi.fn(async () => ({ noop: 1 }));
    const { POST } = definePrivateJobRoute("cleanup", run);
    const response = await POST(request(false));
    expect(response.status).toBe(404);
    expect(run).not.toHaveBeenCalled();
  });

  it("records a durable heartbeat before returning success", async () => {
    const { POST } = definePrivateJobRoute("cleanup", async () => ({ deleted: 3 }));
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ job: "cleanup", ok: true, stats: { deleted: 3 } });
    expect(recordJobSuccess).toHaveBeenCalledWith("cleanup", expect.any(Number));
  });

  /**
   * `workers/jobs/README.md` documents curling a single job by hand, and the
   * dispatcher's flag gate does not protect that path. A tick that only reports
   * "the flag is off" wrote a heartbeat, so `/api/health` answered with a small
   * `airtableLastSuccessAgeSeconds` for an integration that had never synced
   * anything — a switched-off integration reading as successful scheduled work
   * is the exact failure the gate exists to prevent.
   */
  it("withholds the heartbeat from a tick that only reports a flag being off", async () => {
    const { POST } = definePrivateJobRoute("airtable", async () => ({ airtableSkippedDisabled: 1 }));
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, stats: { airtableSkippedDisabled: 1 } });
    expect(recordJobSuccess).not.toHaveBeenCalled();
  });

  it("still records a heartbeat for a tick that simply had nothing to do", async () => {
    const { POST } = definePrivateJobRoute("airtable", async () => ({}));
    await POST(request());
    expect(recordJobSuccess).toHaveBeenCalledWith("airtable", expect.any(Number));
  });

  it("records a heartbeat when a disabled sweep sits alongside real work", async () => {
    const { POST } = definePrivateJobRoute("cleanup", async () => ({ airtableSkippedDisabled: 1, deletedOrphans: 4 }));
    await POST(request());
    expect(recordJobSuccess).toHaveBeenCalledWith("cleanup", expect.any(Number));
  });

  it("turns implementation failures into privacy-safe responses", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { POST } = definePrivateJobRoute("cleanup", async () => {
      throw new Error("bucket unreachable");
    });
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      job: "cleanup",
      ok: false,
      stats: {},
      ms: expect.any(Number),
      error: "Job failed",
    });
    expect(captureError).toHaveBeenCalledWith(expect.objectContaining({ message: "bucket unreachable" }), {
      requestId: expect.stringMatching(/^rpc:/u),
      feature: "jobs",
      code: "cleanup",
    });
    // `captureError` has no duration field, so a failed tick's timing only
    // survives if the route logs it separately.
    expect(JSON.parse(logged.mock.calls[0]?.[0] as string)).toMatchObject({
      level: "error",
      msg: "job.failed",
      code: "cleanup",
      durationMs: expect.any(Number),
    });
  });

  it("keeps the sweeps that succeeded, and captures each failure with its own cause", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { POST } = definePrivateJobRoute("cleanup", async () => settledJobStats([
      { name: "orphans", run: async () => ({ deletedOrphans: 7 }) },
      { name: "retention", run: async () => { throw new Error("retention query timed out"); } },
      { name: "expiredExports", run: async () => ({ deletedExpiredExports: 2 }) },
      { name: "operationalErrors", run: async () => { throw new Error("bucket table missing"); } },
    ]));

    const response = await POST(request());

    expect(response.status).toBe(500);
    // A `Promise.all` here reported `{}` — as if none of the four had run.
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.stats).toEqual({ deletedOrphans: 7, deletedExpiredExports: 2 });
    // Partial stats must not read as a healthy tick: no heartbeat is written,
    // so `scheduled_jobs` health still goes stale.
    expect(recordJobSuccess).not.toHaveBeenCalled();
    expect(captureError).toHaveBeenCalledTimes(2);
    expect(captureError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "retention query timed out" }),
      expect.objectContaining({ code: "cleanup.retention" }),
    );
    expect(captureError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "bucket table missing" }),
      expect.objectContaining({ code: "cleanup.operationalErrors" }),
    );
    expect(JSON.parse(logged.mock.calls[0]?.[0] as string)).toMatchObject({
      msg: "job.failed",
      stats: { deletedOrphans: 7, deletedExpiredExports: 2 },
    });
  });

  it("returns the merged stats when every sweep succeeds", async () => {
    const { POST } = definePrivateJobRoute("outbox", async () => settledJobStats([
      { name: "communications", run: async () => ({ sent: 3 }) },
      { name: "adminAuth", run: async () => ({ authSent: 1 }) },
    ]));
    const response = await POST(request());
    expect(response.status).toBe(200);
    const merged = await response.json();
    expect(merged.ok).toBe(true);
    expect(merged.stats).toEqual({ sent: 3, authSent: 1 });
    expect(recordJobSuccess).toHaveBeenCalledWith("outbox", expect.any(Number));
  });
});
