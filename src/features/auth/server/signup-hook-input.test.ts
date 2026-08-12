import { describe, expect, it } from "vitest";
import { parseEnv } from "@/shared/lib/env";
import { OAUTH_SIGNUP_INTENT_COOKIE, sealOAuthSignupIntent } from "./oauth-signup-intent";
import { LEGAL_CONSENT_ERROR, resolveSignupHookInput } from "./signup-hook-input";

const secret = "signup-hook-test-secret-at-least-32-bytes";
const now = Date.UTC(2026, 7, 12, 12, 0, 0);
const base = {
  APP_ENV: "local",
  APP_BASE_URL: "http://localhost:3000",
  SESSION_SECRET: secret,
  ADMIN_AUTH_PROVIDER: "better-auth",
} as const;
const reviewed = parseEnv({
  ...base,
  LEGAL_TERMS_URL: "https://openboard.example/terms",
  LEGAL_TERMS_VERSION: "terms-2026-08",
  LEGAL_PRIVACY_URL: "https://openboard.example/privacy",
  LEGAL_PRIVACY_VERSION: "privacy-2026-08",
});

describe("signup hook input", () => {
  it("keeps email signup on exact current versions", async () => {
    await expect(resolveSignupHookInput(reviewed, {
      path: "/sign-up/email",
      body: {
        organizationName: "Acme Events",
        legalConsentAccepted: true,
        acceptedTermsVersion: "terms-2026-08",
        acknowledgedPrivacyVersion: "privacy-2026-08",
      },
    }, now)).resolves.toMatchObject({
      provisioning: { organizationName: "Acme Events" },
      consent: { termsVersion: "terms-2026-08", privacyVersion: "privacy-2026-08" },
    });
    await expect(resolveSignupHookInput(reviewed, {
      path: "/sign-up/email",
      body: { legalConsentAccepted: true, acceptedTermsVersion: "stale", acknowledgedPrivacyVersion: "privacy-2026-08" },
    }, now)).rejects.toThrow(LEGAL_CONSENT_ERROR);
  });

  it("restores a named workspace from a valid Google callback intent", async () => {
    const token = await sealOAuthSignupIntent({
      provider: "google",
      organizationName: "Acme Events",
      legalVersions: { termsVersion: "terms-2026-08", privacyVersion: "privacy-2026-08" },
    }, secret, now);
    await expect(resolveSignupHookInput(reviewed, {
      path: "/callback/google",
      getCookie: (name) => name === OAUTH_SIGNUP_INTENT_COOKIE ? token : null,
    }, now + 1_000)).resolves.toMatchObject({
      provisioning: { organizationName: "Acme Events" },
      consent: { termsVersion: "terms-2026-08", privacyVersion: "privacy-2026-08" },
    });
  });

  it("carries an invitation through Google without creating a personal workspace", async () => {
    const token = await sealOAuthSignupIntent({
      provider: "google",
      invitationToken: "invitation-bearer-token",
      legalVersions: null,
    }, secret, now);
    await expect(resolveSignupHookInput(parseEnv(base), {
      path: "/callback/:id",
      params: { id: "google" },
      getCookie: () => token,
    }, now + 1_000)).resolves.toEqual({
      provisioning: { invitationToken: "invitation-bearer-token" },
      consent: null,
    });
  });

  it("rejects missing, stale, and tampered Google proof when policy is active", async () => {
    await expect(resolveSignupHookInput(reviewed, {
      path: "/callback/google",
      getCookie: () => null,
    }, now)).rejects.toThrow(LEGAL_CONSENT_ERROR);

    const stale = await sealOAuthSignupIntent({
      provider: "google",
      organizationName: "Acme",
      legalVersions: { termsVersion: "terms-old", privacyVersion: "privacy-2026-08" },
    }, secret, now);
    await expect(resolveSignupHookInput(reviewed, {
      path: "/callback/google",
      getCookie: () => stale,
    }, now + 1_000)).rejects.toThrow(LEGAL_CONSENT_ERROR);
    const tamperIndex = Math.floor(stale.length / 2);
    const tampered = `${stale.slice(0, tamperIndex)}${stale[tamperIndex] === "A" ? "B" : "A"}${stale.slice(tamperIndex + 1)}`;
    await expect(resolveSignupHookInput(reviewed, {
      path: "/callback/google",
      getCookie: () => tampered,
    }, now + 1_000)).rejects.toThrow(/expired or could not be verified/u);
  });

  it("preserves implicit Google signup only while consent is dormant", async () => {
    await expect(resolveSignupHookInput(parseEnv(base), {
      path: "/callback/google",
      getCookie: () => null,
    }, now)).resolves.toEqual({ provisioning: {}, consent: null });
    await expect(resolveSignupHookInput(reviewed, null, now)).rejects.toThrow(LEGAL_CONSENT_ERROR);
  });
});
