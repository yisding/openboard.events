import { afterEach, describe, expect, it, vi } from "vitest";
import { portalAuthRequest } from "./portal-auth-request";

describe("portalAuthRequest", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns a retryable result instead of throwing when the network fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));

    await expect(portalAuthRequest("/verify", { code: "123456" })).resolves.toEqual({
      ok: false,
      status: null,
      message: "Could not reach the server",
    });
  });

  // The screen tells a throttled speaker when they may ask again; without this
  // it can only say "in a few minutes" whatever the limiter actually measured.
  it("carries the limiter's own reset out of a refusal", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: "RATE_LIMITED", message: "Too many code requests" },
    }), { status: 429, headers: { "content-type": "application/json", "retry-after": "453" } })));

    await expect(portalAuthRequest("/request", { email: "speaker@example.com" })).resolves.toMatchObject({
      ok: false,
      status: 429,
      retryAfterSeconds: 453,
    });
  });

  it("preserves successful portal response data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { alreadySignedIn: true, message: "Signed in" },
    }), { status: 200, headers: { "content-type": "application/json" } })));

    await expect(portalAuthRequest("/verify", { code: "123456" })).resolves.toEqual({
      ok: true,
      data: { alreadySignedIn: true, message: "Signed in" },
    });
  });
});
