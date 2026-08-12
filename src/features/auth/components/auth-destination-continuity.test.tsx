import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ForgotPasswordForm } from "./forgot-password-form";
import { SignupForm } from "./signup-form";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams("next=%2Fjoin%3Ftoken%3Dinvite-123"),
}));

Object.assign(globalThis, { React });

describe("authentication destination continuity", () => {
  it("keeps an invitation when an existing user switches from signup to sign-in", () => {
    const html = renderToStaticMarkup(<SignupForm />);

    expect(html).toContain('href="/login?next=%2Fjoin%3Ftoken%3Dinvite-123"');
    expect(html).not.toContain("Organization name");
  });

  it("keeps an invitation available while password recovery begins", () => {
    const html = renderToStaticMarkup(<ForgotPasswordForm enabled />);

    expect(html).toContain('href="/login?next=%2Fjoin%3Ftoken%3Dinvite-123"');
  });
});
