import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { config, middleware } from "./middleware";

function requestFor(path: string, cookies: Record<string, string> = {}): NextRequest {
  const request = new NextRequest(`https://example.test${path}`);
  for (const [name, value] of Object.entries(cookies)) request.cookies.set(name, value);
  return request;
}

describe("request-path header", () => {
  it("carries the requested path, with its query, into the signed-out redirect", () => {
    const response = middleware(requestFor("/organizations/org-1/billing?plan=pro"));
    expect(response.headers.get("x-middleware-override-headers")).toContain("x-openboard-request-path");
    expect(response.headers.get("x-middleware-request-x-openboard-request-path"))
      .toBe("/organizations/org-1/billing?plan=pro");
  });

  it("covers every prefix whose pages read the header", () => {
    // A page outside the matcher never sees the header and silently falls back,
    // which reads as a working deep-link redirect while sending the user
    // somewhere else. Keep the matcher and the readers in step.
    const readers = ["/events", "/portal", "/organizations", "/account"];
    for (const prefix of readers) {
      expect(config.matcher).toContain(`${prefix}/:path*`);
    }
  });
});

describe("signed-out redirects", () => {
  it("sends an admin page to login with the requested path as next", () => {
    const response = middleware(requestFor("/events/evt-1/dashboard"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location"))
      .toBe("https://example.test/login?next=%2Fevents%2Fevt-1%2Fdashboard");
  });

  it("does not redirect organization pages, which authorize in their own layout", () => {
    // The org tree has no cookie-shaped redirect here on purpose: its layout
    // resolves the Better Auth session and redirects with a real `next`.
    const response = middleware(requestFor("/organizations/org-1/team"));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });
});
