import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ConfirmEmailPage from "./page";

Object.assign(globalThis, { React });

describe("scanner-safe email confirmation page", () => {
  it("requires an explicit POST while preserving the safe workspace destination", async () => {
    const html = renderToStaticMarkup(await ConfirmEmailPage({
      searchParams: Promise.resolve({ token: "secret-token", next: "/organizations/workspace-id" }),
    }));

    expect(html).toContain("Confirm your email");
    expect(html).toContain('method="post"');
    expect(html).toContain('action="/api/auth/confirm-email"');
    expect(html).toContain('type="hidden" name="token" value="secret-token"');
    expect(html).toContain('type="hidden" name="next" value="/organizations/workspace-id"');
    expect(html).toContain("Confirm and continue");
  });

  it("does not render a confirmation form for an incomplete link", async () => {
    const html = renderToStaticMarkup(await ConfirmEmailPage({
      searchParams: Promise.resolve({ next: "https://attacker.example/steal" }),
    }));

    expect(html).toContain("This confirmation link is incomplete");
    expect(html).toContain('href="/signup/verified?error=invalid&amp;next=%2Forganizations"');
    expect(html).not.toContain('action="/api/auth/confirm-email"');
  });
});
