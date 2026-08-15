/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpeakerQuickAdd, type QuickAddedSpeaker } from "./speaker-quick-add";
import { settle } from "@tests/support/react";

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

function buttonNamed(name: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === name);
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("SpeakerQuickAdd pending contract", () => {
  it("reports the request boundary and adds the speaker before becoming idle", async () => {
    let resolveRequest!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise((resolve) => { resolveRequest = resolve; }));
    const onAdded = vi.fn<(speaker: QuickAddedSpeaker) => void>();
    const onPendingChange = vi.fn<(pending: boolean) => void>();

    await act(async () => root.render(
      <SpeakerQuickAdd eventId="event-1" onAdded={onAdded} onPendingChange={onPendingChange} />,
    ));
    await act(async () => buttonNamed("Add a speaker")?.click());
    const email = container.querySelector<HTMLInputElement>('input[type="email"]');
    if (!email) throw new Error("expected quick-add email input");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(email, "ada@example.com");
      email.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => buttonNamed("Add speaker")?.click());

    expect(onPendingChange).toHaveBeenLastCalledWith(true);
    expect(buttonNamed("Adding…")?.disabled).toBe(true);
    expect(onAdded).not.toHaveBeenCalled();

    resolveRequest(Response.json({ data: { contact: {
      contactId: "a5300000-0000-4000-8000-000000000001",
      name: "Ada Lovelace",
      email: "ada@example.com",
    } } }));
    await settle();

    expect(onAdded).toHaveBeenCalledWith({
      contactId: "a5300000-0000-4000-8000-000000000001",
      name: "Ada Lovelace",
    });
    expect(onAdded.mock.invocationCallOrder[0]).toBeLessThan(onPendingChange.mock.invocationCallOrder[1] ?? Infinity);
    expect(onPendingChange.mock.calls).toEqual([[true], [false]]);
    expect(buttonNamed("Add a speaker")).toBeDefined();
  });

  it("clears pending without selecting a stale speaker when its containing dialog is replaced", async () => {
    let resolveRequest!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise((resolve) => { resolveRequest = resolve; }));
    const onAdded = vi.fn<(speaker: QuickAddedSpeaker) => void>();
    const onPendingChange = vi.fn<(pending: boolean) => void>();

    await act(async () => root.render(
      <SpeakerQuickAdd eventId="event-1" onAdded={onAdded} onPendingChange={onPendingChange} />,
    ));
    await act(async () => buttonNamed("Add a speaker")?.click());
    const email = container.querySelector<HTMLInputElement>('input[type="email"]');
    if (!email) throw new Error("expected quick-add email input");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(email, "grace@example.com");
      email.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => buttonNamed("Add speaker")?.click());

    expect(onPendingChange).toHaveBeenLastCalledWith(true);
    await act(async () => root.render(<div>Replacement dialog</div>));
    expect(onPendingChange.mock.calls).toEqual([[true], [false]]);

    resolveRequest(Response.json({ data: { contact: {
      contactId: "a5300000-0000-4000-8000-000000000002",
      name: "Grace Hopper",
      email: "grace@example.com",
    } } }));
    await settle();

    expect(onAdded).not.toHaveBeenCalled();
    expect(onPendingChange.mock.calls).toEqual([[true], [false]]);
  });
});
