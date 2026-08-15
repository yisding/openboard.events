/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFlowKeyboardNav } from "./use-flow-keyboard-nav";

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

function Flow({ onClose }: { onClose: () => void }) {
  useFlowKeyboardNav({ ids: ["a", "b"], activeId: "a", onNavigate: () => undefined, onClose });
  return null;
}

async function mount(onClose: () => void) {
  await act(async () => root.render(<Flow onClose={onClose} />));
}

function pressEscape() {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.querySelectorAll("dialog").forEach((dialog) => dialog.remove());
});

describe("useFlowKeyboardNav Escape", () => {
  it("closes the flow when no native dialog owns the keystroke", async () => {
    const onClose = vi.fn();
    await mount(onClose);

    await act(async () => pressEscape());

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // One Escape must reach exactly one handler. When the drawer's own <dialog>
  // answers the close request, running onClose here too raced the unsaved-work
  // confirmation against the keystroke that opened it, and Escape did nothing
  // at all on a dirty drawer.
  it("leaves the keystroke to an open dialog rather than closing twice", async () => {
    const onClose = vi.fn();
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    document.body.append(dialog);
    await mount(onClose);

    await act(async () => pressEscape());

    expect(onClose).not.toHaveBeenCalled();
  });
});
