import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import HomePage from "./page";

vi.mock("@/shared/lib/env", () => ({
  isCredentialFreeLocalDemo: () => false,
}));

Object.assign(globalThis, { React });

describe("public landing page", () => {
  it("offers account creation and sign-in without requiring a guessed route", () => {
    const html = renderToStaticMarkup(<HomePage />);

    expect(html).toContain('href="/signup"');
    expect(html).toContain("Create your workspace");
    expect(html).toContain('href="/login"');
    expect(html).toContain("Sign in");
  });
});
