import { afterEach, describe, expect, it, vi } from "vitest";
import { onRequestError } from "./instrumentation";

const request = {
  path: "/events/id/dashboard",
  method: "GET",
  headers: { "cf-ray": "ray-123" },
};

const context = {
  routerKind: "App Router" as const,
  routePath: "/events/[eventId]/dashboard",
  routeType: "render" as const,
  renderSource: "server-rendering" as const,
  revalidateReason: undefined,
};

describe("Next request error instrumentation", () => {
  afterEach(() => vi.restoreAllMocks());

  it("captures uncaught render errors with the normalized route and request id", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await onRequestError(new Error("render exploded"), request, context);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(spy.mock.calls[0]?.[0] as string)).toMatchObject({
      msg: "error.captured",
      requestId: "ray-123",
      feature: "next-render",
      code: "UNCAUGHT_REQUEST_ERROR",
      route: "/events/[eventId]/dashboard",
      error: "render exploded",
    });
  });

  it("ignores Next's expected redirect/not-found control-flow signals", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await onRequestError({ digest: "NEXT_REDIRECT;replace;/login;307;" }, request, context);
    await onRequestError({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" }, request, context);
    expect(spy).not.toHaveBeenCalled();
  });
});
