import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCloudflareContext: vi.fn(),
  recordOperationalError: vi.fn(),
}));

vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: mocks.getCloudflareContext }));
vi.mock("@/shared/server/operational-errors", () => ({ recordOperationalError: mocks.recordOperationalError }));

import { captureError } from "./error-tracking";

describe("captureError", () => {
  beforeEach(() => {
    mocks.getCloudflareContext.mockReset().mockImplementation(() => { throw new Error("no Cloudflare context"); });
    mocks.recordOperationalError.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs a real Error's message and stack alongside the given context", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = new Error("boom");
    captureError(error, { requestId: "req-1", feature: "api", eventId: "evt-1", code: "INTERNAL" });

    expect(spy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(spy.mock.calls[0]?.[0] as string);
    expect(payload).toMatchObject({
      level: "error",
      msg: "error.captured",
      requestId: "req-1",
      feature: "api",
      eventId: "evt-1",
      code: "INTERNAL",
      error: "boom",
    });
    expect(payload.stack).toContain("boom");
  });

  it("normalizes a non-Error throw into an Error before logging", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    captureError("just a string", { requestId: "req-2", feature: "jobs" });

    const payload = JSON.parse(spy.mock.calls[0]?.[0] as string);
    expect(payload.error).toBe("just a string");
    expect(payload.eventId).toBeUndefined();
    expect(payload.code).toBeUndefined();
    expect(typeof payload.stack).toBe("string");
  });

  it("schedules privacy-safe persistence with waitUntil in a deployed Worker", async () => {
    const waitUntil = vi.fn();
    mocks.getCloudflareContext.mockReturnValue({
      env: { APP_ENV: "production", DATABASE_URL: "postgres://configured" },
      ctx: { waitUntil },
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = new Error("boom");
    const context = { requestId: "ray-1", feature: "api", code: "INTERNAL" };

    captureError(error, context);

    expect(waitUntil).toHaveBeenCalledTimes(1);
    await waitUntil.mock.calls[0]?.[0];
    expect(mocks.recordOperationalError).toHaveBeenCalledWith(error, context);
  });

  it("does not attempt persistence in local workerd", () => {
    const waitUntil = vi.fn();
    mocks.getCloudflareContext.mockReturnValue({
      env: { APP_ENV: "local" },
      ctx: { waitUntil },
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    captureError(new Error("local failure"), { requestId: "local", feature: "api" });
    expect(waitUntil).not.toHaveBeenCalled();
    expect(mocks.recordOperationalError).not.toHaveBeenCalled();
  });
});
