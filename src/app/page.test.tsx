import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HomePage from "./page";

const runtime = vi.hoisted(() => ({
  authProvider: "better-auth" as "better-auth" | "fallback",
  demoMode: false,
}));

vi.mock("@/shared/lib/env", () => ({
  getEnv: () => ({ ADMIN_AUTH_PROVIDER: runtime.authProvider }),
  isCredentialFreeLocalDemo: () => runtime.demoMode,
}));

Object.assign(globalThis, { React });

describe("public landing page", () => {
  beforeEach(() => {
    runtime.authProvider = "better-auth";
    runtime.demoMode = false;
  });

  it("offers account creation and sign-in without requiring a guessed route", () => {
    const html = renderToStaticMarkup(<HomePage />);

    expect(html).toContain('href="/signup"');
    expect(html).toContain("Create your workspace");
    expect(html).toContain('href="/login"');
    expect(html).toContain("Sign in");
  });

  it("keeps credential-free fallback users on the live demo path", () => {
    runtime.authProvider = "fallback";
    runtime.demoMode = true;
    const html = renderToStaticMarkup(<HomePage />);

    expect(html).toContain('href="/events"');
    expect(html).toContain("Explore the live demo");
    expect(html).not.toContain('href="/signup"');
  });

  it("routes database-backed fallback deployments to sign-in instead of signup", () => {
    runtime.authProvider = "fallback";

    const html = renderToStaticMarkup(<HomePage />);

    expect(html).toContain('href="/login"');
    expect(html).toContain("Open your workspace");
    expect(html).not.toContain("Explore the live demo");
    expect(html).not.toContain('href="/signup"');
  });
});
