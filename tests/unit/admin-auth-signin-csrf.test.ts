import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `/api/auth/[...action]` is hand-rolled and never passes through
 * `defineHandler`, so it does not inherit that chokepoint's origin check the
 * way every other state-changing route does. On the fallback provider — the
 * default, and what deployed environments run — `sign-in` mints the `ob_admin`
 * JWT cookie straight from the request body. `SameSite=Lax` stops a forged
 * cross-site post from *sending* that cookie, not from *storing* it, so a
 * cross-origin form post would hand the organizer's browser the attacker's
 * session and everything uploaded next would land in the attacker's workspace.
 */

const authenticateAdmin = vi.fn(async () => ({ userId: "00000000-0000-4000-8000-000000000001", email: "organizer@example.com", name: "Organizer" }));

vi.mock("@/shared/lib/env", () => ({
  getEnv: () => ({ ADMIN_AUTH_PROVIDER: "fallback", APP_ENV: "local" }),
}));

vi.mock("@/features/auth", () => ({
  ADMIN_COOKIE: "ob_admin",
  adminCookieOptions: () => ({ path: "/", httpOnly: true, sameSite: "lax" as const }),
  authenticateAdmin: (...args: unknown[]) => authenticateAdmin(...(args as [])),
  signAdminToken: vi.fn(async () => "signed-admin-token"),
  throttleAdminLogin: vi.fn(async () => "attempt-key"),
  clearAdminLoginThrottle: vi.fn(async () => undefined),
  nudgeAdminAuthEmailOutbox: vi.fn(),
}));

const { POST } = await import("@/app/api/auth/[...action]/route");

const post = (action: string[], body: unknown, headers: Record<string, string>) =>
  POST(
    new NextRequest(`http://localhost:3000/api/auth/${action.join("/")}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ action }) },
  );

const credentials = { email: "attacker@evil.example", password: "a long enough password" };

describe("POST /api/auth/[...action] origin check", () => {
  beforeEach(() => authenticateAdmin.mockClear());

  it("rejects a cross-origin sign-in before minting the admin cookie", async () => {
    const response = await post(["sign-in"], credentials, { origin: "https://evil.example" });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: { code: "FORBIDDEN", message: "Cross-origin request rejected" },
    });
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(authenticateAdmin).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin forced sign-out", async () => {
    const response = await post(["sign-out"], {}, { referer: "https://evil.example/attack" });

    expect(response.status).toBe(403);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("still signs in from the app's own origin", async () => {
    const response = await post(["sign-in"], credentials, { origin: "http://localhost:3000" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { signedIn: true } });
    expect(response.headers.getSetCookie().join(";")).toContain("ob_admin=signed-admin-token");
  });

  it("still serves a header-less non-browser caller such as the deploy smoke script", async () => {
    const response = await post(["sign-in"], credentials, {});

    expect(response.status).toBe(200);
    expect(authenticateAdmin).toHaveBeenCalledTimes(1);
  });
});
