import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { POST as impersonatePost } from "./impersonate/route";
import { POST as impersonateRenewPost } from "./impersonate/renew/route";
import { POST as logoutPost } from "./logout/route";
import { POST as requestPost } from "./request/route";
import { POST as verifyPost } from "./verify/route";

/**
 * These five routes call `assertSameOrigin` (`@/shared/server/csrf`) by hand
 * (PLAN P3-SEC) rather than being rebuilt onto `defineHandler`, which the four
 * original ones predate and which the impersonation renewal joins to keep the
 * pair of impersonation routes shaped alike.
 *
 * The check runs before any body parsing or DB access, so a
 * mismatched Origin 403s without needing a database — see
 * `src/shared/server/csrf.test.ts` for the check's own unit coverage and
 * `src/shared/server/handler.test.ts` for the `defineHandler`-route
 * equivalent.
 */
describe("portal auth routes reject cross-site Origin (PLAN P3-SEC)", () => {
  const evil = { origin: "https://evil.test" };

  it("POST /api/internal/auth/portal/request", async () => {
    const response = await requestPost(new NextRequest("https://example.test/api/internal/auth/portal/request", {
      method: "POST",
      headers: evil,
      body: "{}",
    }));
    expect(response.status).toBe(403);
  });

  it("POST /api/internal/auth/portal/verify", async () => {
    const response = await verifyPost(new NextRequest("https://example.test/api/internal/auth/portal/verify", {
      method: "POST",
      headers: evil,
      body: "{}",
    }));
    expect(response.status).toBe(403);
  });

  it("POST /api/internal/auth/portal/impersonate", async () => {
    const response = await impersonatePost(new NextRequest("https://example.test/api/internal/auth/portal/impersonate", {
      method: "POST",
      headers: evil,
      body: "{}",
    }));
    expect(response.status).toBe(403);
  });

  it("POST /api/internal/auth/portal/impersonate/renew", async () => {
    const response = await impersonateRenewPost(new NextRequest("https://example.test/api/internal/auth/portal/impersonate/renew", {
      method: "POST",
      headers: evil,
      body: "{}",
    }));
    expect(response.status).toBe(403);
  });

  it("POST /api/internal/auth/portal/logout", async () => {
    const response = await logoutPost(new NextRequest("https://example.test/api/internal/auth/portal/logout", {
      method: "POST",
      headers: evil,
      body: "{}",
    }));
    expect(response.status).toBe(403);
  });
});
