import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForgotPasswordForm } from "./forgot-password-form";
import { SignupForm } from "./signup-form";

const navigation = vi.hoisted(() => ({ searchParams: new URLSearchParams("next=%2Fjoin%3Ftoken%3Dinvite-123") }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => navigation.searchParams,
}));

Object.assign(globalThis, { React });

describe("authentication destination continuity", () => {
  beforeEach(() => {
    navigation.searchParams = new URLSearchParams("next=%2Fjoin%3Ftoken%3Dinvite-123");
  });

  it("keeps an invitation when an existing user switches from signup to sign-in", () => {
    const html = renderToStaticMarkup(<SignupForm />);

    expect(html).toContain('href="/login?next=%2Fjoin%3Ftoken%3Dinvite-123"');
    expect(html).not.toContain("Organization name");
  });

  it("keeps an invitation available while password recovery begins", () => {
    const html = renderToStaticMarkup(<ForgotPasswordForm enabled />);

    expect(html).toContain('href="/login?next=%2Fjoin%3Ftoken%3Dinvite-123"');
  });

  it("shows the exact reviewed policies as a required, compact signup consent", () => {
    const html = renderToStaticMarkup(<SignupForm legalConsent={{
      termsUrl: "https://openboard.example/terms",
      termsVersion: "terms-2026-08",
      privacyUrl: "https://openboard.example/privacy",
      privacyVersion: "privacy-2026-08",
    }} />);

    expect(html).toContain('name="legalConsentAccepted"');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("required");
    expect(html).toContain('href="https://openboard.example/terms"');
    expect(html).toContain('href="https://openboard.example/privacy"');
    expect(html).toContain('target="_blank"');
  });

  it("offers an explicit Google account-creation path without losing an invitation", () => {
    const html = renderToStaticMarkup(<SignupForm googleEnabled />);

    expect(html).toContain("Continue with Google");
    expect(html).toContain("or create with email");
    expect(html).toContain('href="/login?next=%2Fjoin%3Ftoken%3Dinvite-123"');
    expect(html).not.toContain("Organization name");
  });

  it("explains activation and lets email users verify the password they typed", () => {
    const html = renderToStaticMarkup(<SignupForm />);

    expect(html).toContain("What happens next");
    expect(html).toContain("Confirm your email, then continue straight to the workspace that invited you.");
    expect(html).toContain('id="signup-password"');
    expect(html).toContain('aria-controls="signup-password"');
    expect(html).toContain('aria-label="Show password"');
    expect(html).toContain('aria-pressed="false"');
  });

  it("sets expectations for the ordinary self-service setup path", () => {
    navigation.searchParams = new URLSearchParams();
    const html = renderToStaticMarkup(<SignupForm />);

    expect(html).toContain("Start your organization now, then publish your first call for speakers in guided setup.");
    expect(html).toContain("Confirm your email, add your event details, and leave with a ready-to-share CFP.");
    expect(html).toContain("Organization name");
  });
});
