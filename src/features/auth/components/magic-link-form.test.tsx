/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { settle } from "@tests/support/react";
import { MagicLinkForm } from "./magic-link-form";

const fetchMock = vi.hoisted(() => vi.fn());

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const token = "impersonation-token";

let container: HTMLDivElement;
let root: Root;
let assign: ReturnType<typeof vi.fn>;

function button(name: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((candidate) => candidate.textContent?.trim() === name);
}

async function press(name: string) {
  await act(async () => { button(name)?.click(); });
  await settle();
}

function refused(status: number) {
  return { ok: false, status, json: async () => ({ error: { message: "That code or link is invalid or expired" } }) };
}

const accepted = { ok: true, status: 200, json: async () => ({ data: {} }) };

function pathOf(call: number): string {
  return fetchMock.mock.calls[call]?.[0] as string;
}

function bodyOf(call: number): unknown {
  const init = fetchMock.mock.calls[call]?.[1] as { body?: string } | undefined;
  return init?.body === undefined ? undefined : JSON.parse(init.body);
}

async function mount(props: { impersonate: boolean; next?: string }) {
  await act(async () => { root = createRoot(container); });
  await act(async () => root.render(<MagicLinkForm eventSlug="member-event" token={token} {...props} />));
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  assign = vi.fn();
  vi.spyOn(window.location, "assign").mockImplementation(assign);
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("MagicLinkForm impersonation recovery", () => {
  it("offers a fresh link when the one behind this interstitial has expired", async () => {
    // The organizer read the "opening this page did not sign you in" copy,
    // stepped away, and confirmed after the token's life ran out.
    fetchMock.mockResolvedValueOnce(refused(401)).mockResolvedValueOnce(accepted);
    await mount({ impersonate: true, next: "/portal/member-event/profile" });

    await press("Open speaker portal");
    expect(container.textContent).toContain("That link expired while this page was open");

    await press("Get a fresh link and continue");
    expect(pathOf(1)).toBe("/api/internal/auth/portal/impersonate/renew");
    expect(bodyOf(1)).toEqual({ eventSlug: "member-event", token });
    expect(assign).toHaveBeenCalledWith("/portal/member-event/profile");
  });

  it("sends an organizer whose own sign-in lapsed back to the admin", async () => {
    fetchMock.mockResolvedValueOnce(refused(401)).mockResolvedValueOnce(refused(401));
    await mount({ impersonate: true });

    await press("Open speaker portal");
    await press("Get a fresh link and continue");

    expect(container.textContent).toContain("Your organizer sign-in has expired");
    expect(assign).not.toHaveBeenCalled();
  });

  it("keeps a server fault retryable rather than treating it as an expired link", async () => {
    fetchMock.mockResolvedValueOnce(refused(500));
    await mount({ impersonate: true });

    await press("Open speaker portal");

    expect(container.textContent).toContain("try again");
    expect(button("Get a fresh link and continue")).toBeUndefined();
    expect(button("Open speaker portal")).toBeDefined();
  });

  it("offers no renewal for a speaker's own expired magic link", async () => {
    // Nothing here can mint one: the speaker asks for a new code from the
    // sign-in page, which is what the message points at.
    fetchMock.mockResolvedValueOnce(refused(401));
    await mount({ impersonate: false });

    await press("Confirm sign in");

    expect(container.textContent).toContain("That link is invalid or expired");
    expect(button("Get a fresh link and continue")).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
