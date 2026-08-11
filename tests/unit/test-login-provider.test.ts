import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

/**
 * `POST /api/test/login` mints the fallback provider's `ob_admin` cookie and
 * nothing else. Under `ADMIN_AUTH_PROVIDER=better-auth`, `getAdminIdentity`
 * reads `admin_sessions` and never looks at that cookie, so answering 200 hands
 * the caller a session the very next request ignores: the Playwright suite then
 * fails with `401 UNAUTHORIZED Sign in required` in twenty-one places and names
 * the cause in none of them. This is the guard against shipping that shape
 * again.
 *
 * The provider is the whole subject, so `getEnv` is the only collaborator that
 * varies; the database is mocked because a refusal must happen *before* any
 * lookup, and asserting that is easier when a lookup would throw.
 */

const provider = vi.hoisted(() => ({ value: "fallback" as "fallback" | "better-auth" }));

vi.mock("@/shared/lib/env", () => ({
  getEnv: () => ({ TEST_AUTH: "1", ADMIN_AUTH_PROVIDER: provider.value, APP_ENV: "preview" }),
}));

vi.mock("@/db/client", () => ({
  db: {
    select: () => {
      throw new Error("the database must not be reached before the provider is checked");
    },
  },
}));

vi.mock("@/features/auth", () => ({
  ADMIN_COOKIE: "ob_admin",
  adminCookieOptions: () => ({ path: "/" }),
  signAdminToken: vi.fn(async () => "token"),
}));

const { POST } = await import("@/app/api/test/login/route");

const post = () =>
  POST(new NextRequest("https://sb-web-preview.example/api/test/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "organizer@openboard.dev" }),
  }));

describe("POST /api/test/login across admin auth providers", () => {
  it("refuses with a cause when the deployment runs a provider that ignores its cookie", async () => {
    provider.value = "better-auth";
    const response = await post();
    expect(response.status).toBe(409);
    const body = await response.json() as { error?: { code?: string; message?: string } };
    expect(body.error?.code).toBe("CONFLICT");
    // The sentence has to name the variable an operator would change, or the
    // refusal is no more useful than the 401s it replaces.
    expect(body.error?.message).toContain("ADMIN_AUTH_PROVIDER=fallback");
  });

  it("reaches the user lookup under the fallback provider", async () => {
    provider.value = "fallback";
    // The mocked `db.select` throws: getting that far is the assertion that the
    // provider gate let this request through.
    await expect(post()).rejects.toThrow(/must not be reached before the provider is checked/);
  });
});
