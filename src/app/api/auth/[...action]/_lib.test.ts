import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { parseEnv } from "@/shared/lib/env";
import {
  OAUTH_SIGNUP_INTENT_COOKIE,
  openOAuthSignupIntent,
} from "@/features/auth/server/oauth-signup-intent";
import { beginGoogleSignup, handleAdminAuthGet } from "./_lib";

const secret = "google-signup-route-test-secret-at-least-32-bytes";
const dormant = parseEnv({
  APP_ENV: "local",
  APP_BASE_URL: "http://localhost:3000",
  SESSION_SECRET: secret,
  ADMIN_AUTH_PROVIDER: "better-auth",
  GOOGLE_CLIENT_ID: "google-client-id",
  GOOGLE_CLIENT_SECRET: "google-client-secret",
});
const reviewed = parseEnv({
  ...dormant,
  LEGAL_TERMS_URL: "https://openboard.example/terms",
  LEGAL_TERMS_VERSION: "terms-2026-08",
  LEGAL_PRIVACY_URL: "https://openboard.example/privacy",
  LEGAL_PRIVACY_VERSION: "privacy-2026-08",
});

function signupRequest(body: Record<string, unknown>, origin = "http://localhost:3000") {
  return new NextRequest("http://localhost:3000/api/auth/sign-up/google", {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

function cookieValue(response: Response, name: string): string | null {
  const line = response.headers.getSetCookie().find((cookie) => cookie.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).split(";")[0] ?? null : null;
}

describe("Google signup handoff", () => {
  it("forwards an explicit signup and seals the named workspace into a callback-only cookie", async () => {
    let forwarded: Request | null = null;
    const handler = vi.fn(async (request: Request) => {
      forwarded = request;
      return Response.json({ url: "https://accounts.google.com/o/oauth2/v2/auth?state=test", redirect: true }, {
        headers: { "set-cookie": "openboard_admin.oauth_state=state; Path=/; HttpOnly; SameSite=Lax" },
      });
    });
    const response = await beginGoogleSignup(signupRequest({
      organizationName: "Acme Events",
      next: "/organizations",
      legalConsentAccepted: true,
      acceptedTermsVersion: "terms-2026-08",
      acknowledgedPrivacyVersion: "privacy-2026-08",
    }), reviewed, handler);

    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toEqual(expect.arrayContaining([
      expect.stringContaining("openboard_admin.oauth_state=state"),
      expect.stringContaining(`${OAUTH_SIGNUP_INTENT_COOKIE}=`),
    ]));
    const intentCookie = response.headers.getSetCookie()
      .find((cookie) => cookie.startsWith(`${OAUTH_SIGNUP_INTENT_COOKIE}=`)) ?? "";
    expect(intentCookie).toContain("Path=/api/auth/callback/google");
    expect(intentCookie).toContain("HttpOnly");
    expect(intentCookie).toContain("SameSite=lax");

    expect(forwarded).not.toBeNull();
    expect(new URL((forwarded as unknown as Request).url).pathname).toBe("/api/auth/sign-in/social");
    await expect((forwarded as unknown as Request).json()).resolves.toEqual({
      provider: "google",
      callbackURL: "/organizations",
      newUserCallbackURL: "/organizations",
      errorCallbackURL: "/signup?next=%2Forganizations",
      requestSignUp: true,
    });
    const token = cookieValue(response, OAUTH_SIGNUP_INTENT_COOKIE);
    expect(token).toBeTruthy();
    await expect(openOAuthSignupIntent(token ?? "", secret)).resolves.toMatchObject({
      organizationName: "Acme Events",
      legalVersions: { termsVersion: "terms-2026-08", privacyVersion: "privacy-2026-08" },
    });
  });

  it("keeps the invitation return for existing identities and resolves new users after consumption", async () => {
    let forwardedBody: Record<string, unknown> | null = null;
    const handler = vi.fn(async (request: Request) => {
      forwardedBody = await request.json() as Record<string, unknown>;
      return Response.json({ url: "https://accounts.google.com/auth", redirect: true });
    });
    const token = "invitation-bearer-token";
    const next = `/join?token=${encodeURIComponent(token)}`;
    const response = await beginGoogleSignup(signupRequest({ invitationToken: token, next }), dormant, handler);

    expect(response.status).toBe(200);
    expect(forwardedBody).toMatchObject({
      callbackURL: next,
      newUserCallbackURL: "/organizations",
      requestSignUp: true,
    });
    const intent = await openOAuthSignupIntent(cookieValue(response, OAUTH_SIGNUP_INTENT_COOKIE) ?? "", secret);
    expect(intent).toMatchObject({ invitationToken: token, legalVersions: null });
    expect(intent).not.toHaveProperty("organizationName");

    const mismatched = await beginGoogleSignup(signupRequest({ invitationToken: token, next: "/organizations" }), dormant, handler);
    expect(mismatched.status).toBe(400);
    const omitted = await beginGoogleSignup(signupRequest({ organizationName: "Wrong workspace", next }), dormant, handler);
    expect(omitted.status).toBe(400);
  });

  it("rejects cross-origin, incomplete, and stale-policy starts before contacting Google", async () => {
    const handler = vi.fn(async () => Response.json({ url: "https://accounts.google.com/auth" }));
    expect((await beginGoogleSignup(signupRequest({ organizationName: "Acme" }, "https://attacker.example"), reviewed, handler)).status)
      .toBe(403);
    expect((await beginGoogleSignup(signupRequest({ next: "/organizations" }), reviewed, handler)).status).toBe(400);
    const stale = await beginGoogleSignup(signupRequest({
      organizationName: "Acme",
      legalConsentAccepted: true,
      acceptedTermsVersion: "terms-old",
      acknowledgedPrivacyVersion: "privacy-2026-08",
    }), reviewed, handler);
    expect(stale.status).toBe(400);
    await expect(stale.json()).resolves.toMatchObject({ error: { message: expect.stringContaining("Terms of Service") } });
    expect(handler).not.toHaveBeenCalled();
  });

  it("does not mint an intent when Better Auth cannot start OAuth", async () => {
    const response = await beginGoogleSignup(signupRequest({ organizationName: "Acme" }), dormant, async () => (
      Response.json({ code: "PROVIDER_NOT_FOUND" }, { status: 404 })
    ));
    expect(response.status).toBe(404);
    expect(cookieValue(response, OAUTH_SIGNUP_INTENT_COOKIE)).toBeNull();
  });

  it("expires the intent cookie on every Google callback response", async () => {
    const result = await handleAdminAuthGet(
      new NextRequest("http://localhost:3000/api/auth/callback/google?code=test", {
        headers: { cookie: `${OAUTH_SIGNUP_INTENT_COOKIE}=encrypted` },
      }),
      true,
      async () => new Response(null, { status: 302, headers: { location: "/organizations" } }),
      dormant,
    );
    expect(result.status).toBe(302);
    expect(result.headers.get("location")).toBe("/organizations");
    const expired = result.headers.getSetCookie()
      .find((cookie) => cookie.startsWith(`${OAUTH_SIGNUP_INTENT_COOKIE}=`)) ?? "";
    expect(expired).toContain("Path=/api/auth/callback/google");
    expect(expired).toContain("Max-Age=0");
  });
});
