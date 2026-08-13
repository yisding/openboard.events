/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/shared/lib/errors";
import { ToastProvider } from "@/shared/ui/toast";
import { JoinInvitationView } from "./join-invitation-view";

const navigation = vi.hoisted(() => ({ searchParams: new URLSearchParams() }));
const apiMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useSearchParams: () => navigation.searchParams,
}));

vi.mock("@/shared/lib/api-client", () => ({ api: apiMock }));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

async function renderInvitation(): Promise<{ container: HTMLDivElement; unmount: () => Promise<void> }> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<ToastProvider><JoinInvitationView /></ToastProvider>);
    await Promise.resolve();
  });
  return {
    container,
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

describe("invitation recovery", () => {
  beforeEach(() => {
    navigation.searchParams = new URLSearchParams();
    apiMock.mockReset();
  });

  it("offers a safe exit when an invitation link is incomplete", async () => {
    const view = await renderInvitation();
    try {
      expect(view.container.textContent).toContain("This invitation isn't valid");
      expect(view.container.textContent).toContain("This invitation link is incomplete.");
      expect(view.container.querySelector<HTMLAnchorElement>('a[href="/login"]')?.textContent).toContain("Go to sign in");
      expect(apiMock).not.toHaveBeenCalled();
    } finally {
      await view.unmount();
    }
  });

  it("offers the same exit when an invitation is expired", async () => {
    navigation.searchParams = new URLSearchParams("token=expired-token");
    apiMock.mockRejectedValue(new AppError("NOT_FOUND", "That invitation has expired"));
    const view = await renderInvitation();
    try {
      expect(view.container.textContent).toContain("That invitation has expired");
      expect(view.container.querySelector(".metric-icon.amber")).not.toBeNull();
      expect(view.container.querySelector<HTMLAnchorElement>('a[href="/login"]')?.textContent).toContain("Go to sign in");
    } finally {
      await view.unmount();
    }
  });

  it("keeps the invitation through both signed-out account choices", async () => {
    navigation.searchParams = new URLSearchParams("token=invite-123");
    apiMock.mockRejectedValue(new AppError("UNAUTHORIZED", "Sign in"));
    const view = await renderInvitation();
    try {
      expect(view.container.querySelector<HTMLAnchorElement>('a[href="/login?next=%2Fjoin%3Ftoken%3Dinvite-123"]')).not.toBeNull();
      expect(view.container.querySelector<HTMLAnchorElement>('a[href="/signup?next=%2Fjoin%3Ftoken%3Dinvite-123"]')).not.toBeNull();
    } finally {
      await view.unmount();
    }
  });

  it("lets a signed-in user switch to the account that received the invitation", async () => {
    navigation.searchParams = new URLSearchParams("token=invite-123");
    apiMock.mockRejectedValue(new AppError("FORBIDDEN", "This invitation was sent to a different email address"));
    const view = await renderInvitation();
    try {
      expect(view.container.textContent).toContain("Switch accounts to join");
      expect(view.container.querySelector<HTMLButtonElement>("button")?.textContent).toContain("Switch account");
      expect(view.container.querySelector<HTMLAnchorElement>('a[href="/organizations"]')?.textContent).toContain("Stay signed in");
    } finally {
      await view.unmount();
    }
  });
});
