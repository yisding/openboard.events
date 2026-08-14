import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `/api/auth/[...action]` is hand-rolled and never passes through
 * `defineHandler`, so it does not inherit that chokepoint's origin check the
 * way every other state-changing route does. Keep the application origin gate
 * in front of Better Auth so a future provider upgrade cannot silently weaken
 * login-CSRF protection.
 */

const handler = vi.fn(async () => new Response(JSON.stringify({ user: { id: "admin" } }), {
  status: 200,
  headers: {
    "content-type": "application/json",
    "set-cookie": "openboard_admin.session_token=signed-session; Path=/; HttpOnly; SameSite=Lax",
  },
}));

vi.mock("@/shared/lib/env", () => ({
  getEnv: () => ({ APP_ENV: "local" }),
}));

vi.mock("@/features/auth", () => ({
  throttleAdminLogin: vi.fn(async () => "attempt-key"),
  clearAdminLoginThrottle: vi.fn(async () => undefined),
  nudgeAdminAuthEmailOutbox: vi.fn(),
}));

vi.mock("@/features/auth/server/better-auth", () => ({
  getAdminAuth: () => ({ handler }),
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
  beforeEach(() => handler.mockClear());

  it("rejects a cross-origin sign-in before minting the admin cookie", async () => {
    const response = await post(["sign-in"], credentials, { origin: "https://evil.example" });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: { code: "FORBIDDEN", message: "Cross-origin request rejected" },
    });
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(handler).not.toHaveBeenCalled();
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
    expect(response.headers.getSetCookie().join(";")).toContain("openboard_admin.session_token=signed-session");
  });

  it("still serves a header-less non-browser caller such as the deploy smoke script", async () => {
    const response = await post(["sign-in"], credentials, {});

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
