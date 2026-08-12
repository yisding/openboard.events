import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LoginForm } from "./login-form";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams("next=%2Forganizations"),
}));

Object.assign(globalThis, { React });

describe("LoginForm", () => {
  it("shows Google sign-in only when the runtime provider is configured", () => {
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
