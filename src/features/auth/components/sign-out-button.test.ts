/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/shared/ui/toast";
import { SignOutButton, signOutDestination } from "./sign-out-button";

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

afterEach(() => vi.unstubAllGlobals());

async function renderSignOut(compact: boolean) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(ToastProvider, null,
    React.createElement(SignOutButton, { kind: "admin", compact }),
  )));
  const button = container.querySelector<HTMLButtonElement>("button");
  if (!button) throw new Error("SignOutButton did not render a button");
  return {
    button,
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

describe("sign-out destination", () => {
  it("preserves a safe account-switch handoff and rejects external redirects", () => {
    const invitationLogin = "/login?next=%2Fjoin%3Ftoken%3Dinvite-123";
    expect(signOutDestination("admin", undefined, invitationLogin)).toBe(invitationLogin);
    expect(signOutDestination("admin", undefined, "https://attacker.example/steal")).toBe("/login");
    expect(signOutDestination("portal", "community-ai", undefined)).toBe("/portal/community-ai/login");
  });

  it("keeps the compact icon control specialized and uses a bordered shared button otherwise", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    const compact = await renderSignOut(true);
    const labeled = await renderSignOut(false);
    try {
      expect(compact.button.getAttribute("aria-label")).toBe("Sign out");
      expect(compact.button.classList.contains("icon-button")).toBe(true);
      expect(compact.button.classList.contains("button-secondary")).toBe(false);
      expect(labeled.button.textContent).toContain("Sign out");
      // Secondary, not ghost: on `/events` this is the only way off the
      // screen, and a borderless control beside an avatar reads as a caption.
      expect(labeled.button.classList.contains("button-secondary")).toBe(true);
      expect(labeled.button.classList.contains("button-sm")).toBe(true);

      await act(async () => labeled.button.click());
      expect(labeled.button.disabled).toBe(true);
      expect(labeled.button.textContent).toContain("Signing out…");
    } finally {
      await compact.unmount();
      await labeled.unmount();
    }
  });
});
