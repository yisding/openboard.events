/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/shared/ui/toast";
import { PaletteDialog } from "./command-palette";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

/**
 * The entity-jump request itself, by role.
 *
 * `/api/internal/events/[eventId]/search` runs under `adminAuth()`, which
 * defaults to organizer, so a reviewer's request comes back FORBIDDEN and lands
 * them in an error state with a Retry button that can never succeed. Asserting
 * on the placeholder proves the palette *says* the right thing; only watching
 * `fetch` proves it does not ask.
 */
const eventId = "00000000-0000-4000-8000-000000000001";
const base = `/events/${eventId}`;

// `settleCommandPaletteSearch` debounces by 150ms before it fetches.
const DEBOUNCE_MS = 150;

let fetchMock: ReturnType<typeof vi.fn>;
const mounted: Array<() => Promise<void>> = [];

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  while (mounted.length > 0) await mounted.pop()?.();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function openPalette(role: "organizer" | "reviewer"): Promise<HTMLInputElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      React.createElement(ToastProvider, null, React.createElement(PaletteDialog, {
        eventId,
        base,
        role,
        onClose: () => undefined,
      })),
    );
  });
  mounted.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  const input = container.querySelector<HTMLInputElement>('input[role="combobox"]');
  if (!input) throw new Error("palette input did not render");
  return input;
}

async function type(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    // React installs its own value setter on the element; go through the
    // prototype's so the change event carries the new value.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
  });
}

describe("command palette entity search requests", () => {
  it("makes no search request for a reviewer, however much they type", async () => {
    const input = await openPalette("reviewer");
    await type(input, "ada lovelace");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("searches for an organizer once the query is worth a request", async () => {
    const input = await openPalette("organizer");
    await type(input, "ada");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(`/api/internal/events/${eventId}/search`);
  });

  it("still waits for a query worth searching", async () => {
    const input = await openPalette("organizer");
    await type(input, "a");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
