import { beforeEach, describe, expect, it, vi } from "vitest";
import { PRIVATE_JOB_HEADER, PRIVATE_JOB_HEADER_VALUE } from "@/shared/contracts";

vi.mock("@/shared/lib/error-tracking", () => ({ captureError: vi.fn() }));
vi.mock("@/shared/server/job-heartbeats", () => ({ recordJobSuccess: vi.fn() }));

const { captureError } = await import("@/shared/lib/error-tracking");
const { recordJobSuccess } = await import("@/shared/server/job-heartbeats");
const { definePrivateJobRoute } = await import("./_lib");

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

  it("turns implementation failures into privacy-safe responses", async () => {
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
  });
});
