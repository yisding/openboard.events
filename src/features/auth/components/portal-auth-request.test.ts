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
