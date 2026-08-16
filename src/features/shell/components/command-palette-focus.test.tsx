/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/shared/ui/toast";
import { CommandPalette } from "./command-palette";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

/**
 * Opening the palette with ⌘K, then dismissing it, must leave the rest of the
 * page exactly as it was.
 *
 * The palette restores focus to whatever held it when the dialog opened. Left
 * to capture `document.activeElement` at that moment, ⌘K from the dashboard
 * captured a tab `<Link>` — and Next prefetches a link the instant it is
 * focused, so closing the palette re-focused the tab and fired a stray RSC GET
 * for `?tab=today` that read as the palette silently navigating. Focusing the
 * trigger before the dialog mounts is what keeps the return-focus target on a
 * button that does nothing when focused.
 */

const eventId = "00000000-0000-4000-8000-000000000001";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  if (typeof HTMLDialogElement.prototype.showModal !== "function") {
    HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
  }
  if (typeof HTMLDialogElement.prototype.close !== "function") {
    HTMLDialogElement.prototype.close = function close() { this.open = false; };
  }
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function paletteInput(): HTMLInputElement | null {
  return container.querySelector<HTMLInputElement>('input[role="combobox"]');
}

describe("closing the ⌘K palette", () => {
  it("does not hand focus back to the tab that happened to be focused", async () => {
    // A stand-in for a dashboard tab: a link that records the moment it is
    // focused, which on a real Next `<Link>` is the moment it prefetches.
    const tab = document.createElement("a");
    tab.href = "/events/x/dashboard?tab=today";
    tab.textContent = "Today";
    document.body.append(tab);

    await act(async () => root.render(
      <ToastProvider>
        <CommandPalette eventId={eventId} base={`/events/${eventId}`} role="organizer" />
      </ToastProvider>,
    ));

    // The organizer is on the tab when they reach for the palette.
    tab.focus();
    expect(document.activeElement).toBe(tab);
    let refocused = 0;
    tab.addEventListener("focus", () => { refocused += 1; });

    // ⌘K from anywhere in the shell.
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    expect(paletteInput()).not.toBeNull();
    // Focus was taken from the tab by the palette, not left on it.
    expect(document.activeElement).not.toBe(tab);

    // Escape closes it.
    const input = paletteInput();
    await act(async () => {
      input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    // The frame-deferred focus restoration runs next tick.
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))); });

    expect(paletteInput()).toBeNull();
    // The tab was never re-focused, so nothing prefetched `?tab=today` behind
    // the organizer's back.
    expect(refocused).toBe(0);

    tab.remove();
  });
});
