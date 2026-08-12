import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import HomePage from "./page";

const runtime = vi.hoisted(() => ({ authProvider: "better-auth" as "better-auth" | "fallback" }));

vi.mock("@/shared/lib/env", () => ({
  getEnv: () => ({ ADMIN_AUTH_PROVIDER: runtime.authProvider }),
  isCredentialFreeLocalDemo: () => runtime.authProvider === "fallback",
}));

Object.assign(globalThis, { React });

describe("public landing page", () => {
  it("offers account creation and sign-in without requiring a guessed route", () => {
    runtime.authProvider = "better-auth";
    const html = renderToStaticMarkup(<HomePage />);

    expect(html).toContain('href="/signup"');
    expect(html).toContain("Create your workspace");
    expect(html).toContain('href="/login"');
    expect(html).toContain("Sign in");
  });

  it("keeps fallback and credential-free users on the live demo path", () => {
    runtime.authProvider = "fallback";
    const html = renderToStaticMarkup(<HomePage />);

    expect(html).toContain('href="/events"');
    expect(html).toContain("Explore the live demo");
    expect(html).not.toContain('href="/signup"');
  });
});
