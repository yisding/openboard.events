import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HomePage from "./page";

const runtime = vi.hoisted(() => ({
  authProvider: "better-auth" as "better-auth" | "fallback",
}));
const getAdminSession = vi.hoisted(() => vi.fn());

vi.mock("@/features/auth", () => ({ getAdminSession }));
vi.mock("@/shared/lib/env", () => ({
  getEnv: () => ({ ADMIN_AUTH_PROVIDER: runtime.authProvider }),
}));

Object.assign(globalThis, { React });

describe("public landing page", () => {
  beforeEach(() => {
    runtime.authProvider = "better-auth";
    getAdminSession.mockReset().mockResolvedValue(null);
  });

  it("offers account creation and sign-in without requiring a guessed route", async () => {
    const html = renderToStaticMarkup(await HomePage());

    expect(html).toContain('href="/signup"');
    expect(html).toContain("Create your workspace");
    expect(html).toContain('href="/login"');
    expect(html).toContain("Sign in");
  });

  it("routes fallback deployments to sign-in instead of signup", async () => {
    runtime.authProvider = "fallback";

    const html = renderToStaticMarkup(await HomePage());

    expect(html).toContain('href="/login"');
    expect(html).toContain("Open your workspace");
    expect(html).not.toContain('href="/signup"');
  });

  it("opens the workspace directly for an existing session", async () => {
    getAdminSession.mockResolvedValueOnce({ userId: "00000000-0000-4000-8000-000000000001" });

    const html = renderToStaticMarkup(await HomePage());

    expect(html).toContain('href="/organizations"');
    expect(html).toContain("Open your workspace");
    expect(html).not.toContain('href="/signup"');
    expect(html).not.toContain(">Sign in<");
  });

  it("sends both public CTAs to the seeded event rather than a demo-only slug", async () => {
    const html = renderToStaticMarkup(await HomePage());

    expect(html).toContain('href="/submit/ai-engineer-sandbox-event/f00d8460-e8d9-58de-ab01-f37d4ffe53df"');
    expect(html).toContain('href="/e/ai-engineer-sandbox-event/agenda"');
    expect(html).not.toContain("/submit/ai-engineer/technical-talks");
    expect(html).not.toContain("/e/ai-engineer/schedule");
  });
});
