/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForgotPasswordForm } from "./forgot-password-form";
import { LoginForm } from "./login-form";
import { ResetPasswordForm } from "./reset-password-form";
import { SignupForm } from "./signup-form";

const navigation = vi.hoisted(() => ({ searchParams: new URLSearchParams("next=%2Fjoin%3Ftoken%3Dinvite-123") }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => navigation.searchParams,
}));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

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

  it("reveals the password on request and hides it again after changing signup methods", async () => {
    navigation.searchParams = new URLSearchParams();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    try {
      await act(async () => root.render(<SignupForm googleEnabled />));

      const password = container.querySelector<HTMLInputElement>("#signup-password");
      const toggle = container.querySelector<HTMLButtonElement>('[aria-controls="signup-password"]');
      expect(password?.type).toBe("password");
      expect(toggle?.getAttribute("aria-label")).toBe("Show password");
      expect(toggle?.getAttribute("aria-pressed")).toBe("false");

      await act(async () => toggle?.click());
      expect(password?.type).toBe("text");
      expect(toggle?.getAttribute("aria-label")).toBe("Hide password");
      expect(toggle?.getAttribute("aria-pressed")).toBe("true");

      const continueWithGoogle = [...container.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent?.includes("Continue with Google"));
      await act(async () => continueWithGoogle?.click());
      const useEmail = [...container.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent?.includes("Use email instead"));
      await act(async () => useEmail?.click());

      const remountedPassword = container.querySelector<HTMLInputElement>("#signup-password");
      const remountedToggle = container.querySelector<HTMLButtonElement>('[aria-controls="signup-password"]');
      expect(remountedPassword?.type).toBe("password");
      expect(remountedToggle?.getAttribute("aria-label")).toBe("Show password");
      expect(remountedToggle?.getAttribute("aria-pressed")).toBe("false");
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("uses the same accessible password controls for activation sign-in and recovery", () => {
    navigation.searchParams = new URLSearchParams("next=%2Forganizations");
    const login = renderToStaticMarkup(<LoginForm />);
    expect(login).toContain('id="login-password"');
    expect(login).toContain('aria-controls="login-password"');
    expect(login).toContain('aria-label="Show password"');

    navigation.searchParams = new URLSearchParams("token=reset-token&next=%2Forganizations");
    const reset = renderToStaticMarkup(<ResetPasswordForm />);
    expect(reset).toContain('id="reset-password"');
    expect(reset).toContain('aria-controls="reset-password"');
    expect(reset).toContain('aria-label="Show new password"');
    expect(reset).toContain('id="reset-password-confirm"');
    expect(reset).toContain('aria-controls="reset-password-confirm"');
    expect(reset).toContain('aria-label="Show confirm new password"');
  });
});
