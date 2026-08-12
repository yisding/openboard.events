import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HomePage from "./page";

const runtime = vi.hoisted(() => ({
  authProvider: "better-auth" as "better-auth" | "fallback",
}));

vi.mock("@/shared/lib/env", () => ({
  getEnv: () => ({ ADMIN_AUTH_PROVIDER: runtime.authProvider }),
}));

Object.assign(globalThis, { React });

describe("public landing page", () => {
  beforeEach(() => {
    runtime.authProvider = "better-auth";
  });

  it("offers account creation and sign-in without requiring a guessed route", () => {
    const html = renderToStaticMarkup(<HomePage />);

    expect(html).toContain('href="/signup"');
    expect(html).toContain("Create your workspace");
    expect(html).toContain('href="/login"');
    expect(html).toContain("Sign in");
  });

  it("routes fallback deployments to sign-in instead of signup", () => {
    runtime.authProvider = "fallback";

    const html = renderToStaticMarkup(<HomePage />);

    expect(html).toContain('href="/login"');
    expect(html).toContain("Open your workspace");
    expect(html).not.toContain('href="/signup"');
  });

  it("sends both public CTAs to the seeded event rather than a demo-only slug", () => {
    const html = renderToStaticMarkup(<HomePage />);

    expect(html).toContain('href="/submit/ai-engineer-sandbox-event/f00d8460-e8d9-58de-ab01-f37d4ffe53df"');
    expect(html).toContain('href="/e/ai-engineer-sandbox-event/agenda"');
    expect(html).not.toContain("/submit/ai-engineer/technical-talks");
    expect(html).not.toContain("/e/ai-engineer/schedule");
  });
});
