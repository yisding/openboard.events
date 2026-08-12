import { describe, expect, it } from "vitest";
import {
  OAUTH_SIGNUP_INTENT_COOKIE,
  OAUTH_SIGNUP_INTENT_SECONDS,
  oauthSignupIntentCookieOptions,
  openOAuthSignupIntent,
  sealOAuthSignupIntent,
} from "./oauth-signup-intent";
import { fromBase64Url, toBase64Url } from "./crypto";

const secret = "oauth-signup-test-secret-at-least-32-bytes";
const now = Date.UTC(2026, 7, 12, 12, 0, 0);

describe("encrypted OAuth signup intent", () => {
  it("round-trips a named workspace and exact reviewed policy versions", async () => {
    const token = await sealOAuthSignupIntent({
      provider: "google",
      organizationName: "Acme Events",
      legalVersions: { termsVersion: "terms-2026-08", privacyVersion: "privacy-2026-08" },
    }, secret, now);

    expect(token).not.toContain("Acme");
    expect(await openOAuthSignupIntent(token, secret, now + 1_000)).toMatchObject({
      provider: "google",
      organizationName: "Acme Events",
      legalVersions: { termsVersion: "terms-2026-08", privacyVersion: "privacy-2026-08" },
      issuedAt: now,
      expiresAt: now + OAUTH_SIGNUP_INTENT_SECONDS * 1000,
    });
  });

  it("keeps invitation bearer credentials confidential and rejects tampering", async () => {
    const token = await sealOAuthSignupIntent({
      provider: "google",
      invitationToken: "invitation-bearer-token",
      legalVersions: null,
    }, secret, now);
    expect(token).not.toContain("invitation");

    const tamperedEnvelope = fromBase64Url(token);
    tamperedEnvelope[1] = (tamperedEnvelope[1] ?? 0) ^ 1;
    await expect(openOAuthSignupIntent(toBase64Url(tamperedEnvelope), secret, now + 1_000))
      .resolves.toBeNull();
    await expect(openOAuthSignupIntent(token, `${secret}-wrong`, now + 1_000)).resolves.toBeNull();
  });

  it("rejects expired and structurally invalid intents", async () => {
    const token = await sealOAuthSignupIntent({
      provider: "google",
      organizationName: "Acme Events",
      legalVersions: null,
    }, secret, now);
    await expect(openOAuthSignupIntent(token, secret, now + OAUTH_SIGNUP_INTENT_SECONDS * 1000))
      .resolves.toBeNull();
    await expect(sealOAuthSignupIntent({
      provider: "google",
      organizationName: "Acme",
      invitationToken: "also-present",
      legalVersions: null,
    }, secret, now)).rejects.toThrow(/workspace or carry one invitation/u);
  });

  it("scopes a short-lived HttpOnly cookie to the Google callback", () => {
    expect(OAUTH_SIGNUP_INTENT_COOKIE).toBe("openboard_oauth_signup");
    expect(oauthSignupIntentCookieOptions({ APP_ENV: "preview" })).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/api/auth/callback/google",
      maxAge: OAUTH_SIGNUP_INTENT_SECONDS,
    });
    expect(oauthSignupIntentCookieOptions({ APP_ENV: "local" }).secure).toBe(false);
  });
});
