import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { googleSignInErrorMessage, LoginForm } from "./login-form";

const navigation = vi.hoisted(() => ({ searchParams: new URLSearchParams("next=%2Forganizations") }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => navigation.searchParams,
}));

Object.assign(globalThis, { React });

describe("LoginForm", () => {
  beforeEach(() => {
    navigation.searchParams = new URLSearchParams("next=%2Forganizations");
  });

  it("turns an unknown Google identity into a clear signup recovery", () => {
    expect(googleSignInErrorMessage("signup_disabled"))
      .toBe("No Openboard account uses that Google address yet.");
    expect(googleSignInErrorMessage("access_denied"))
      .toBe("Google sign-in did not finish. Try again or continue with email.");
    expect(googleSignInErrorMessage(null)).toBe("");
  });

  it("offers Google account creation to an address sign-in does not know", () => {
    navigation.searchParams = new URLSearchParams("error=signup_disabled&next=%2Forganizations");
    const html = renderToStaticMarkup(<LoginForm googleEnabled />);

    expect(html).toContain("No Openboard account uses that Google address yet");
    expect(html).toContain("Create your workspace with Google");
    expect(html).toContain('href="/signup?next=%2Forganizations&amp;provider=google"');
  });

  it("keeps the ordinary signup link free of the Google handoff", () => {
    navigation.searchParams = new URLSearchParams("error=access_denied&next=%2Forganizations");
    const html = renderToStaticMarkup(<LoginForm googleEnabled />);

    expect(html).not.toContain("Create your workspace with Google");
    expect(html).toContain('href="/signup?next=%2Forganizations"');
  });

  it("shows Google sign-in only when OAuth is configured", () => {
    const enabled = renderToStaticMarkup(<LoginForm googleEnabled />);
    const disabled = renderToStaticMarkup(<LoginForm />);

    expect(enabled).toContain("Continue with Google");
    expect(enabled).toContain('type="button"');
    expect(disabled).not.toContain("Continue with Google");
  });

  it("offers signup and password recovery without losing the requested workspace", () => {
    const html = renderToStaticMarkup(<LoginForm />);

    expect(html).toContain('href="/signup?next=%2Forganizations"');
    expect(html).toContain('href="/login/forgot?next=%2Forganizations"');
    expect(html).toContain("Create your workspace");
  });
});
