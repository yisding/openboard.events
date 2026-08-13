import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ToastProvider } from "@/shared/ui/toast";
import { SignOutButton, signOutDestination } from "./sign-out-button";

Object.assign(globalThis, { React });

describe("sign-out destination", () => {
  it("preserves a safe account-switch handoff and rejects external redirects", () => {
    const invitationLogin = "/login?next=%2Fjoin%3Ftoken%3Dinvite-123";
    expect(signOutDestination("admin", undefined, invitationLogin)).toBe(invitationLogin);
    expect(signOutDestination("admin", undefined, "https://attacker.example/steal")).toBe("/login");
    expect(signOutDestination("portal", "community-ai", undefined)).toBe("/portal/community-ai/login");
  });

  it("keeps the compact icon control specialized and uses the shared ghost button otherwise", () => {
    const compact = renderToStaticMarkup(React.createElement(ToastProvider, null,
      React.createElement(SignOutButton, { kind: "admin", compact: true }),
    ));
    const labeled = renderToStaticMarkup(React.createElement(ToastProvider, null,
      React.createElement(SignOutButton, { kind: "admin" }),
    ));

    expect(compact).toContain('<button type="button" class="icon-button" aria-label="Sign out" title="Sign out">');
    expect(compact).not.toContain("button-ghost");
    expect(labeled).toContain('<button type="button" class="button button-ghost button-sm">');
    expect(labeled).toContain("Sign out</button>");
  });
});
