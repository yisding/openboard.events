import * as React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AuthBrandPanel } from "./components/auth-brand-panel";

Object.assign(globalThis, { React });

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("auth page wayfinding", () => {
  it("keeps the marketing panel supplementary to each task heading", () => {
    const html = renderToStaticMarkup(<AuthBrandPanel />);

    expect(html).toContain('<aside class="login-brand-panel" aria-label="About Openboard">');
    expect(html).toContain('<p class="login-brand-heading">Build programs people remember.</p>');
    expect(html).not.toContain("<h1");
  });

  it("gives every sign-in and password route a specific document title", () => {
    const expectations = [
      ["../../app/login/page.tsx", 'title: "Sign in"'],
      ["../../app/login/forgot/page.tsx", 'title: "Reset your password"'],
      ["../../app/login/reset/page.tsx", 'title: "Choose a new password"'],
      ["../../app/portal/[eventSlug]/login/page.tsx", 'title: "Speaker portal sign in"'],
    ] as const;

    for (const [path, title] of expectations) expect(read(path), path).toContain(title);
  });

  it("uses the shared supplementary panel on every two-column auth route", () => {
    for (const path of [
      "../../app/login/page.tsx",
      "../../app/login/forgot/page.tsx",
      "../../app/login/reset/page.tsx",
      "../../app/join/page.tsx",
      "../../app/signup/page.tsx",
      "../../app/signup/check-email/page.tsx",
      "../../app/signup/confirm/page.tsx",
      "../../app/signup/verified/page.tsx",
    ]) {
      const source = read(path);
      expect(source, path).toContain("<AuthBrandPanel />");
      expect(source, path).not.toContain("Build programs people remember.");
    }
  });
});
