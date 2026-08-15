/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import Link from "next/link";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/shared/lib/errors";
import { UnsavedWorkGuardProvider } from "@/shared/ui/app/unsaved-work-guard";
import { SessionsPanel, type AdminSessionSummary } from "./sessions-panel";
import { settle } from "@tests/support/react";

const apiMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());
const routerPushMock = vi.hoisted(() => vi.fn());
const routerReplaceMock = vi.hoisted(() => vi.fn());

vi.mock("@/shared/lib/api-client", () => ({ api: apiMock }));
vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPushMock, replace: routerReplaceMock }),
}));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const chrome: AdminSessionSummary = {
  id: "f0000000-0000-4000-8000-000000000001",
  ipAddress: "1.2.3.4",
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
  createdAt: "2026-08-13T10:00:00.000Z",
  expiresAt: "2026-08-20T10:00:00.000Z",
  isCurrent: false,
};
const firefox: AdminSessionSummary = {
  id: "f0000000-0000-4000-8000-000000000002",
  ipAddress: "5.6.7.8",
  userAgent: "Mozilla/5.0 (Android 15; Mobile; rv:143.0) Gecko/143.0 Firefox/143.0",
  createdAt: "2026-08-12T10:00:00.000Z",
  expiresAt: "2026-08-19T10:00:00.000Z",
  isCurrent: true,
};
// What the panel actually prints for those agents — the raw string is never on
// screen, because two sign-ins from one browser print it identically.
const chromeDevice = "Chrome on Mac";
const firefoxDevice = "Firefox on Android";

let container: HTMLDivElement;
let root: Root;


function buttonsNamed(name: string): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>("button")]
    .filter((button) => button.textContent?.trim() === name);
}

function buttonNamed(name: string): HTMLButtonElement | undefined {
  return buttonsNamed(name)[0];
}

async function renderPanel() {
  await act(async () => root.render(
    <UnsavedWorkGuardProvider>
      <Link href="/organizations">Leave sessions</Link>
      <SessionsPanel initialSessions={[chrome, firefox]} />
    </UnsavedWorkGuardProvider>,
  ));
}

async function confirmChromeRevoke() {
  const row = [...container.querySelectorAll("tbody tr")]
    .find((candidate) => candidate.textContent?.includes(chromeDevice));
  await act(async () => row?.querySelector<HTMLButtonElement>("button")?.click());
  await act(async () => buttonsNamed("Revoke").at(-1)?.click());
  await settle();
}

async function confirmSignOutEverywhere() {
  await act(async () => buttonNamed("Sign out everywhere")?.click());
  await act(async () => buttonsNamed("Sign out everywhere").at(-1)?.click());
  await settle();
}

beforeEach(() => {
  apiMock.mockReset();
  toastMock.mockReset();
  routerPushMock.mockReset();
  routerReplaceMock.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
  HTMLDialogElement.prototype.close = function close() { this.open = false; };
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("session mutation recovery", () => {
  it("replays the exact revoke after a lost response without restoring a ghost session", async () => {
    apiMock
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce({ revoked: true });
    await renderPanel();
    await confirmChromeRevoke();

    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock.mock.calls[0]?.[0]).toBe(`me/sessions/${chrome.id}`);
    expect(apiMock.mock.calls[0]?.[2]).toEqual({ method: "DELETE" });
    expect(container.textContent).toContain("Session change unconfirmed");
    expect(container.textContent).toContain("We don’t know whether that session was revoked.");
    expect(container.textContent).not.toContain(chromeDevice);
    expect(container.textContent).toContain(firefoxDevice);
    expect(buttonNamed("Sign out everywhere")?.disabled).toBe(true);
    expect(buttonNamed("Revoke")?.disabled).toBe(true);

    await act(async () => container.querySelector<HTMLAnchorElement>('a[href="/organizations"]')?.click());
    expect(routerPushMock).not.toHaveBeenCalled();
    expect(buttonNamed("Discard changes")).toBeUndefined();
    expect(buttonNamed("Working…")?.disabled).toBe(true);
    await act(async () => buttonNamed("Stay here")?.click());

    await act(async () => buttonNamed("Retry exact revoke")?.click());
    await settle();

    expect(apiMock).toHaveBeenCalledTimes(2);
    expect(apiMock.mock.calls[1]?.[0]).toBe(apiMock.mock.calls[0]?.[0]);
    expect(apiMock.mock.calls[1]?.[2]).toEqual(apiMock.mock.calls[0]?.[2]);
    expect(container.textContent).not.toContain("Session change unconfirmed");
    expect(container.textContent).not.toContain(chromeDevice);
    expect(buttonNamed("Sign out everywhere")?.disabled).toBe(false);
  });

  it("adopts an authoritative list when checking proves the target is absent", async () => {
    apiMock
      .mockRejectedValueOnce(new Error("malformed success envelope"))
      .mockResolvedValueOnce([firefox]);
    await renderPanel();
    await confirmChromeRevoke();

    await act(async () => buttonNamed("Check sessions")?.click());
    await settle();

    expect(apiMock.mock.calls[1]?.slice(0, 1)).toEqual(["me/sessions"]);
    expect(container.textContent).not.toContain("Session change unconfirmed");
    expect(container.textContent).not.toContain(chromeDevice);
    expect(container.textContent).toContain(firefoxDevice);
    expect(toastMock).toHaveBeenLastCalledWith("Sessions checked — that session is not active.");
  });

  it("keeps the exact revoke locked when a check still sees the target", async () => {
    apiMock
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce([chrome, firefox]);
    await renderPanel();
    await confirmChromeRevoke();

    await act(async () => buttonNamed("Check sessions")?.click());
    await settle();

    expect(container.textContent).toContain("Session change unconfirmed");
    expect(container.textContent).toContain(chromeDevice);
    expect(buttonNamed("Retry exact revoke")).toBeDefined();
    expect(buttonNamed("Sign out everywhere")?.disabled).toBe(true);
    expect(toastMock).toHaveBeenLastCalledWith(
      "That session is currently listed, but the earlier revoke may still be finishing. Retry the exact revoke before leaving.",
      { kind: "error" },
    );
  });

  it("stays visibly locked through repeated offline replay and check attempts", async () => {
    apiMock
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockRejectedValueOnce(new AppError("INTERNAL", "gateway lost response"))
      .mockRejectedValueOnce(new TypeError("still offline"));
    await renderPanel();
    await confirmChromeRevoke();

    await act(async () => buttonNamed("Retry exact revoke")?.click());
    await settle();
    await act(async () => buttonNamed("Check sessions")?.click());
    await settle();

    expect(apiMock).toHaveBeenCalledTimes(3);
    expect(apiMock.mock.calls[1]?.[0]).toBe(apiMock.mock.calls[0]?.[0]);
    expect(apiMock.mock.calls[1]?.[2]).toEqual(apiMock.mock.calls[0]?.[2]);
    expect(apiMock.mock.calls[2]?.[0]).toBe("me/sessions");
    expect(container.textContent).toContain("Session change unconfirmed");
    expect(buttonNamed("Retry exact revoke")).toBeDefined();
    expect(buttonNamed("Check sessions")).toBeDefined();
    expect(buttonNamed("Sign out everywhere")?.disabled).toBe(true);
    expect(toastMock).toHaveBeenLastCalledWith(
      "Sessions still couldn’t be checked. Restore your connection and try again.",
      { kind: "error" },
    );
  });

  it("restores the target and remains editable after a definitive rejection", async () => {
    apiMock.mockRejectedValueOnce(new AppError("FORBIDDEN", "You cannot revoke that session"));
    await renderPanel();
    await confirmChromeRevoke();

    expect(container.textContent).not.toContain("Session change unconfirmed");
    expect(container.textContent).toContain(chromeDevice);
    expect(buttonNamed("Sign out everywhere")?.disabled).toBe(false);
    expect(buttonNamed("Revoke")?.disabled).toBe(false);
    expect(toastMock).toHaveBeenCalledWith("You cannot revoke that session", { kind: "error" });
  });

  it("keeps sign out everywhere editable after a definitive rejection", async () => {
    apiMock.mockRejectedValueOnce(new AppError("FORBIDDEN", "Sign out everywhere is not allowed"));
    await renderPanel();
    await confirmSignOutEverywhere();

    expect(container.textContent).not.toContain("Session change unconfirmed");
    expect(container.textContent).toContain(chromeDevice);
    expect(container.textContent).toContain(firefoxDevice);
    expect(buttonNamed("Sign out everywhere")?.disabled).toBe(false);
    expect(toastMock).toHaveBeenCalledWith("Sign out everywhere is not allowed", { kind: "error" });
  });

  it("treats unauthorized exact replay after a self-revoke as recovered logout", async () => {
    apiMock
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockRejectedValueOnce(new AppError("UNAUTHORIZED", "Sign in required"));
    await renderPanel();
    await confirmChromeRevoke();

    await act(async () => buttonNamed("Retry exact revoke")?.click());
    await settle();

    expect(apiMock.mock.calls[1]?.[0]).toBe(`me/sessions/${chrome.id}`);
    expect(routerReplaceMock).toHaveBeenCalledWith("/login");
    expect(toastMock).toHaveBeenLastCalledWith("You’re signed out. Sign in again to continue.");
  });

  it("freezes sign out everywhere and recovers an unauthorized replay as logout", async () => {
    apiMock
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockRejectedValueOnce(new AppError("UNAUTHORIZED", "Sign in required"));
    await renderPanel();
    await confirmSignOutEverywhere();

    expect(apiMock.mock.calls[0]?.[0]).toBe("me/sessions/revoke-all");
    expect(apiMock.mock.calls[0]?.[2]).toEqual({ method: "POST" });
    expect(container.textContent).toContain("We don’t know whether every session was signed out.");
    expect(buttonNamed("Retry exact sign out")).toBeDefined();

    await act(async () => buttonNamed("Retry exact sign out")?.click());
    await settle();

    expect(apiMock.mock.calls[1]?.[0]).toBe(apiMock.mock.calls[0]?.[0]);
    expect(apiMock.mock.calls[1]?.[2]).toEqual(apiMock.mock.calls[0]?.[2]);
    expect(routerReplaceMock).toHaveBeenCalledWith("/login");
    expect(toastMock).toHaveBeenLastCalledWith("You’re signed out. Sign in again to continue.");
  });
});

describe("identifying which session is which", () => {
  it("names each device and marks the one doing the reading", async () => {
    await renderPanel();

    const rows = [...container.querySelectorAll("tbody tr")];
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining(chromeDevice),
      expect.stringContaining(firefoxDevice),
    ]);
    expect(container.textContent).not.toContain("Mozilla/5.0");
    expect(rows.filter((row) => row.textContent?.includes("This device")).map((row) => row.textContent))
      .toEqual([expect.stringContaining(firefoxDevice)]);
  });

  it("signs the reader out instead of leaving them on a dead page when they revoke their own session", async () => {
    apiMock.mockResolvedValueOnce({ revoked: true });
    await renderPanel();

    const row = [...container.querySelectorAll("tbody tr")]
      .find((candidate) => candidate.textContent?.includes(firefoxDevice));
    await act(async () => row?.querySelector<HTMLButtonElement>("button")?.click());
    expect(container.textContent).toContain("This is the device you're using right now.");
    await act(async () => buttonsNamed("Sign out").at(-1)?.click());
    await settle();

    expect(apiMock.mock.calls[0]?.[0]).toBe(`me/sessions/${firefox.id}`);
    expect(routerReplaceMock).toHaveBeenCalledWith("/login");
    expect(toastMock).toHaveBeenLastCalledWith("Signed out on this device. Sign in again to continue.");
  });
});
