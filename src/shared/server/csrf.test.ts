import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { assertSameOrigin } from "./csrf";

describe("assertSameOrigin (PLAN P3-SEC)", () => {
  it("allows a request with no Origin/Referer", () => {
    expect(() => assertSameOrigin(new NextRequest("https://example.test/resource", { method: "POST" }))).not.toThrow();
  });

  it("allows a same-origin Origin header", () => {
    expect(() => assertSameOrigin(new NextRequest("https://example.test/resource", {
      method: "POST",
      headers: { origin: "https://example.test" },
    }))).not.toThrow();
  });

  it("rejects a cross-site Origin header", () => {
    expect(() => assertSameOrigin(new NextRequest("https://example.test/resource", {
      method: "POST",
      headers: { origin: "https://evil.test" },
    }))).toThrow("Cross-origin request rejected");
  });

  it("falls back to Referer when Origin is absent, and still rejects a mismatch", () => {
    expect(() => assertSameOrigin(new NextRequest("https://example.test/resource", {
      method: "POST",
      headers: { referer: "https://evil.test/attack-page" },
    }))).toThrow("Cross-origin request rejected");
  });

  it("rejects an unparseable Origin header", () => {
    expect(() => assertSameOrigin(new NextRequest("https://example.test/resource", {
      method: "POST",
      headers: { origin: "not-a-url" },
    }))).toThrow("Cross-origin request rejected");
  });
});
