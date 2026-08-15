import { afterEach, describe, expect, it, vi } from "vitest";
import { errorMessage, log } from "./log";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("log", () => {
  it("routes each level to the matching console method", () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    for (const level of ["debug", "info", "warn", "error"] as const) {
      log({ level, msg: "probe", requestId: "req-1", feature: "test" });
    }

    expect(debug).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("emits one JSON object so the log stream stays queryable by field", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    log({ level: "warn", msg: "rate_limit.degraded", requestId: "ray-1", feature: "api", eventId: "evt-1" });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(spy.mock.calls[0]?.[0] as string)).toEqual({
      level: "warn",
      msg: "rate_limit.degraded",
      requestId: "ray-1",
      feature: "api",
      eventId: "evt-1",
    });
  });
});

describe("errorMessage", () => {
  it("reads an Error's message and stringifies anything else", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("just a string")).toBe("just a string");
    expect(errorMessage(undefined)).toBe("undefined");
  });
});
