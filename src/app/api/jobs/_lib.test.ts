import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const SECRET = "s".repeat(32);

// getEnv() is the repo's one sanctioned process.env seam (scripts/check-invariants.sh);
// mock it rather than poking process.env directly from a test.
vi.mock("@/shared/lib/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/lib/env")>()),
  getEnv: () => ({ CRON_SECRET: SECRET }),
}));

const { defineJobRoute } = await import("./_lib");

function request(headers: Record<string, string> = {}) {
  return new NextRequest("https://example.test/api/jobs/cleanup", { method: "POST", headers });
}

describe("defineJobRoute", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects a request with no or wrong secret as UNAUTHORIZED", async () => {
    const { POST } = defineJobRoute("cleanup", async () => ({ noop: 1 }));
    const noHeader = await POST(request());
    expect(noHeader.status).toBe(401);
    const wrong = await POST(request({ "x-cron-secret": "wrong" }));
    expect(wrong.status).toBe(401);
  });

  it("runs the job and returns its stats when the secret matches", async () => {
    const { POST } = defineJobRoute("cleanup", async () => ({ deleted: 3 }));
    const response = await POST(request({ "x-cron-secret": SECRET }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ job: "cleanup", ok: true, stats: { deleted: 3 } });
  });

  it("captures the raw error via the P3-OPS seam and still returns a 500 job-failure envelope", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { POST } = defineJobRoute("cleanup", async () => { throw new Error("bucket unreachable"); });
    const response = await POST(request({ "x-cron-secret": SECRET }));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toMatchObject({ job: "cleanup", ok: false });
    expect(body.error).toContain("bucket unreachable");

    expect(spy).toHaveBeenCalledTimes(1);
    const captured = JSON.parse(spy.mock.calls[0]?.[0] as string);
    expect(captured).toMatchObject({ level: "error", msg: "error.captured", feature: "jobs", code: "cleanup", error: "bucket unreachable" });
  });
});
