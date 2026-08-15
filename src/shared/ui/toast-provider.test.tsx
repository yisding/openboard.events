/** @vitest-environment happy-dom */

import { readFileSync } from "node:fs";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, useToast, type ToastOptions } from "./toast";

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

let publish: ((message: string, options?: ToastOptions) => void) | null = null;
let container: HTMLDivElement;
let root: Root;

function Harness() {
  publish = useToast().toast;
  return null;
}

beforeEach(async () => {
  vi.useFakeTimers();
  publish = null;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<ToastProvider><Harness /></ToastProvider>));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

function toast(message: string, options?: ToastOptions) {
  if (!publish) throw new Error("Toast harness did not mount");
  act(() => publish?.(message, options));
}

describe("ToastProvider", () => {
  it("keeps the newest three messages instead of replacing the active toast", () => {
    toast("First failed", { kind: "error" });
    toast("Second failed", { kind: "error" });
    toast("Third failed", { kind: "error" });
    toast("Fourth failed", { kind: "error" });

    expect(container.querySelectorAll(".toast")).toHaveLength(3);
    expect(container.textContent).not.toContain("First failed");
    expect(container.textContent).toContain("Second failed");
    expect(container.textContent).toContain("Third failed");
    expect(container.textContent).toContain("Fourth failed");
  });

  it("keeps errors until their named dismiss control is used", () => {
    toast("Decision emails could not be sent", { kind: "error", durationMs: 5 });
    act(() => vi.advanceTimersByTime(60_000));

    expect(container.textContent).toContain("Decision emails could not be sent");
    const dismiss = container.querySelector<HTMLButtonElement>('button[aria-label="Dismiss “Decision emails could not be sent”"]');
    if (!dismiss) throw new Error("Named error dismissal was not rendered");
    act(() => dismiss.click());
    expect(container.textContent).not.toContain("Decision emails could not be sent");
  });

  // The stack paints above `<dialog>` drawers by sitting in the top layer, and
  // top-layer order also decides what a modal dialog blocks: an element below
  // the dialog takes no pointer events and leaves the accessibility tree. Both
  // openers therefore re-raise the stack straight after `showModal()`, or an
  // error toast already on screen is buried by the next drawer.
  it("is re-raised above a modal dialog opened after it", () => {
    const kit = readFileSync(`${process.cwd()}/src/shared/ui/ui-kit.tsx`, "utf8");

    expect(kit).toContain('import { raiseTopLayerStack } from "@/shared/ui/top-layer"');
    expect(kit.match(/dialog\.showModal\(\);\n(?:\s*\/\/[^\n]*\n)*\s*raiseTopLayerStack\(\);/g)).toHaveLength(2);
  });

  it("continues to auto-dismiss successes", () => {
    toast("Saved", { durationMs: 50 });
    expect(container.textContent).toContain("Saved");

    act(() => vi.advanceTimersByTime(50));
    expect(container.textContent).not.toContain("Saved");
  });
});
