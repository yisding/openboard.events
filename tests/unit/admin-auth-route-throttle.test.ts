import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * M42 — the application-layer sign-in throttle applies to Better Auth's *own*
 * credential endpoint, not just to our legacy `POST /api/auth/sign-in` shape.
 *
 * `/api/auth/[...action]` is a catch-all, and `sign-in/email` arrives as
 * `action = ["sign-in", "email"]`. It used to match neither the `sign-out` nor
 * the `sign-in` branch and fall straight through to `betterAuthHandler` with
 * no `throttleAdminLogin` call at all — so `admin_login_attempts` was never
 * incremented for it and the 5-per-15-minutes block could never arm. Better
 * Auth's own 3-per-10s limiter lives in per-isolate memory on Workers, which
 * is not a substitute.
 *
 * The route's collaborators are mocked because the assertion is about
 * *routing*: which requests reach the throttle. `throttleAdminLogin` itself is
 * exercised against real Postgres in `tests/integration/auth.test.ts`.
 */

const throttleAdminLogin = vi.fn(async () => "attempt-key");
const clearAdminLoginThrottle = vi.fn(async () => undefined);
const checkRateLimit = vi.fn(async (database: unknown, args: unknown) => { void database; void args; });
const nudgeAdminAuthEmailOutbox = vi.fn((waitUntil: unknown) => { void waitUntil; });
const handler = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));

vi.mock("@/shared/lib/env", () => ({
  getEnv: () => ({ ADMIN_AUTH_PROVIDER: "better-auth", APP_ENV: "local" }),
}));

vi.mock("@/features/auth", () => ({
  ADMIN_COOKIE: "ob_admin",
  adminCookieOptions: () => ({ path: "/" }),
  authenticateAdmin: vi.fn(async () => null),
  signAdminToken: vi.fn(async () => "token"),
  throttleAdminLogin: (...args: unknown[]) => throttleAdminLogin(...(args as [])),
  clearAdminLoginThrottle: (...args: unknown[]) => clearAdminLoginThrottle(...(args as [])),
  nudgeAdminAuthEmailOutbox: (...args: unknown[]) => nudgeAdminAuthEmailOutbox(...(args as [unknown])),
}));

vi.mock("@/shared/server/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => checkRateLimit(...(args as [unknown, unknown])),
}));

vi.mock("@/features/auth/server/better-auth", () => ({
  getAdminAuth: () => ({ handler }),
}));

const { POST } = await import("@/app/api/auth/[...action]/route");

const post = (action: string[], body: unknown) =>
  POST(
    new NextRequest(`http://localhost:3000/api/auth/${action.join("/")}`, {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.7" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ action }) },
  );

describe("POST /api/auth/[...action] throttling", () => {
  beforeEach(() => {
    throttleAdminLogin.mockClear();
    clearAdminLoginThrottle.mockClear();
    checkRateLimit.mockClear();
    nudgeAdminAuthEmailOutbox.mockClear();
    handler.mockClear();
    handler.mockImplementation(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));
  });

  afterEach(() => vi.clearAllMocks());

  it("throttles Better Auth's native /sign-in/email and still forwards it", async () => {
    const response = await post(["sign-in", "email"], { email: "organizer@example.com", password: "a long enough password" });

    expect(throttleAdminLogin).toHaveBeenCalledTimes(1);
    expect(throttleAdminLogin).toHaveBeenCalledWith("organizer@example.com", "203.0.113.7");
    expect(handler).toHaveBeenCalledTimes(1);
    // The native contract is preserved — the throttle wraps the endpoint, it
    // does not re-shape the response.
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    // A successful sign-in clears the counter, same as the legacy path.
    expect(clearAdminLoginThrottle).toHaveBeenCalledWith("attempt-key");
  });

  it("answers 429 without forwarding once the throttle blocks", async () => {
    throttleAdminLogin.mockImplementationOnce(async () => {
      const { AppError } = await import("@/shared/lib/errors");
      throw new AppError("RATE_LIMITED", "Too many sign-in attempts. Try again later.");
    });

    const response = await post(["sign-in", "email"], { email: "organizer@example.com", password: "a long enough password" });
    expect(response.status).toBe(429);
    expect(handler).not.toHaveBeenCalled();
  });

  it("still throttles the legacy /sign-in shape", async () => {
    await post(["sign-in"], { email: "organizer@example.com", password: "a long enough password" });
    expect(throttleAdminLogin).toHaveBeenCalledTimes(1);
  });

  it("forwards a non-credential endpoint untouched", async () => {
    await post(["get-session"], {});
    expect(throttleAdminLogin).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("durably limits signup by both IP and normalized email, then nudges delivery", async () => {
    const response = await post(["sign-up", "email"], {
      email: " New.Owner@Example.com ",
      password: "a long enough password",
      name: "New Owner",
    });

    expect(response.status).toBe(200);
    expect(checkRateLimit).toHaveBeenCalledTimes(2);
    expect(checkRateLimit.mock.calls.map((call) => call[1])).toEqual([
      { key: "auth-email:sign-up/email:ip:203.0.113.7", limit: 10, windowMs: 3_600_000 },
      { key: "auth-email:sign-up/email:email:new.owner@example.com", limit: 4, windowMs: 3_600_000 },
    ]);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(nudgeAdminAuthEmailOutbox).toHaveBeenCalledTimes(1);
  });

  it("does not create an account after the durable signup limit blocks", async () => {
    checkRateLimit.mockImplementationOnce(async () => {
      const { AppError } = await import("@/shared/lib/errors");
      throw new AppError("RATE_LIMITED", "Too many requests. Please try again shortly.");
    });

    const response = await post(["sign-up", "email"], {
      email: "new.owner@example.com",
      password: "a long enough password",
      name: "New Owner",
    });
    expect(response.status).toBe(429);
    expect(handler).not.toHaveBeenCalled();
    expect(nudgeAdminAuthEmailOutbox).not.toHaveBeenCalled();
  });

  it.each([
    ["sign-up/email", ["sign-up", "email"]],
    ["send-verification-email", ["send-verification-email"]],
    ["request-password-reset", ["request-password-reset"]],
  ])("IP-limits malformed requests to %s before Better Auth validation", async (path, action) => {
    const response = await post(action, { email: "not-an-email" });

    expect(response.status).toBe(200);
    expect(checkRateLimit).toHaveBeenCalledTimes(1);
    expect(checkRateLimit).toHaveBeenCalledWith(expect.anything(), {
      key: `auth-email:${path}:ip:203.0.113.7`,
      limit: path === "sign-up/email" ? 10 : 20,
      windowMs: path === "sign-up/email" ? 3_600_000 : 600_000,
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("preserves the email-not-verified state on the stable sign-in contract", async () => {
    handler.mockImplementationOnce(async () => new Response(JSON.stringify({
      code: "EMAIL_NOT_VERIFIED",
      message: "Email not verified",
    }), { status: 403, headers: { "content-type": "application/json" } }));

    const response = await post(["sign-in"], { email: "new.owner@example.com", password: "a long enough password" });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: { code: "EMAIL_NOT_VERIFIED", message: "Confirm your email before signing in" },
    });
    expect(clearAdminLoginThrottle).toHaveBeenCalledWith("attempt-key");
  });
});
