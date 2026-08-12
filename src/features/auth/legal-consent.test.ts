import { describe, expect, it } from "vitest";
import { signupLegalConsent } from "./legal-consent";

describe("signupLegalConsent", () => {
  it("returns the reviewed URL and version pair only when the set is complete", () => {
    expect(signupLegalConsent({
      LEGAL_TERMS_URL: "https://example.com/terms",
      LEGAL_TERMS_VERSION: "terms-2026-08",
      LEGAL_PRIVACY_URL: "https://example.com/privacy",
      LEGAL_PRIVACY_VERSION: "privacy-2026-08",
    })).toEqual({
      termsUrl: "https://example.com/terms",
      termsVersion: "terms-2026-08",
      privacyUrl: "https://example.com/privacy",
      privacyVersion: "privacy-2026-08",
    });
    expect(() => signupLegalConsent({
      LEGAL_TERMS_URL: "https://example.com/terms",
      LEGAL_TERMS_VERSION: undefined,
      LEGAL_PRIVACY_URL: undefined,
      LEGAL_PRIVACY_VERSION: undefined,
    })).toThrow(/must be complete/u);
  });
});
