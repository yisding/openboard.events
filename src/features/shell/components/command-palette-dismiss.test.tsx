/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/shared/ui/toast";
import { PaletteDialog } from "./command-palette";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

/**
 * Escape closes the palette, and says so.
 *
 * The palette dismisses itself rather than leaning on the native `cancel`
 * event, which browser/React combinations do not dispatch consistently from a
 * focused combobox. Marking the keystroke handled is the other half of that
 * decision and is load-bearing outside this component: the guided tour listens
 * for Escape on the document, and by the time it hears this one the dialog it
 * would have deferred to is already closed. Without `defaultPrevented` the tour
 * silently paused itself every time somebody dismissed the palette.
 */

const eventId = "00000000-0000-4000-8000-000000000001";
const mounted: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (mounted.length > 0) await mounted.pop()?.();
});

async function openPalette(onClose: () => void): Promise<HTMLInputElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      React.createElement(ToastProvider, null, React.createElement(PaletteDialog, {
        eventId,
        base: `/events/${eventId}`,
        role: "organizer",
        onClose,
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

describe("dismissing the command palette", () => {
  it("closes on Escape and marks the keystroke handled for everyone else", async () => {
    const onClose = vi.fn();
    const input = await openPalette(onClose);
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });

    await act(async () => { input.dispatchEvent(escape); });

    expect(onClose).toHaveBeenCalledTimes(1);
    // The claim a document-level listener can check: this Escape is spoken for.
    expect(escape.defaultPrevented).toBe(true);
  });

  it("leaves every other key to the palette's own controls", async () => {
    const onClose = vi.fn();
    const input = await openPalette(onClose);
    const typed = new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true });

    await act(async () => { input.dispatchEvent(typed); });

    expect(onClose).not.toHaveBeenCalled();
    expect(typed.defaultPrevented).toBe(false);
  });
});
