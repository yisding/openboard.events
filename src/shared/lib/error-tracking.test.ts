import { afterEach, describe, expect, it, vi } from "vitest";
import { captureError } from "./error-tracking";

describe("captureError", () => {
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
});
