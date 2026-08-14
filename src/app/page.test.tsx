import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HomePage from "./page";

const getAdminSession = vi.hoisted(() => vi.fn());

vi.mock("@/features/auth", () => ({ getAdminSession }));

Object.assign(globalThis, { React });

describe("public landing page", () => {
  beforeEach(() => {
    getAdminSession.mockReset().mockResolvedValue(null);
  });

  it("offers account creation and sign-in without requiring a guessed route", async () => {
    const html = renderToStaticMarkup(await HomePage());

    expect(html).toContain('href="/signup"');
    expect(html).toContain("Create your workspace");
    expect(html).toContain('href="/login"');
    expect(html).toContain("Sign in");
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

  it("keeps the decorative dashboard mockup out of the keyboard and accessibility trees", async () => {
    const html = renderToStaticMarkup(await HomePage());

    expect(html).toContain('<div class="hero-art" aria-hidden="true">');
    expect(html).not.toContain('aria-label="Openboard dashboard preview"');
    expect(html.match(/aria-label="Openboard home"/gu)).toHaveLength(1);
    expect(html).toContain('<span class="brand" aria-hidden="true">');
  });
});
