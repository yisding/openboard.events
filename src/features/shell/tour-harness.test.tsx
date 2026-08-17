/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/shared/ui/toast";
import { TourHarness } from "./tour-harness";

vi.mock("next/navigation", () => ({
  usePathname: () => "/kitchen-sink/tour",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));
vi.mock("@/shared/ui/emoji-rain", () => ({ emojiRain: vi.fn() }));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

/**
 * The kitchen-sink harness is a probe, and a probe you can only run once is
 * half a probe. Ending the tour used to leave "Start the tour" disabled and
 * labelled "Running" over a tutorial that had visibly stopped, with Reset —
 * which also wipes the transport log the page exists to show — as the only way
 * back to a second run.
 */

const mounted: Array<() => Promise<void>> = [];

function control(label: string): HTMLButtonElement {
  const match = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent?.trim() === label || candidate.getAttribute("aria-label") === label,
  );
  if (!match) throw new Error(`No control named ${label}`);
  return match;
}

function has(label: string): boolean {
  return [...document.querySelectorAll("button")].some((candidate) => candidate.textContent?.trim() === label);
}

async function click(label: string) {
  const node = control(label);
  await act(async () => { node.click(); });
}

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      media: query, matches: false, onchange: null,
      addEventListener: () => undefined, removeEventListener: () => undefined,
      addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false,
    }),
  });
});

afterEach(async () => {
  while (mounted.length > 0) await mounted.pop()?.();
  document.body.innerHTML = "";
});

async function renderHarness() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(ToastProvider, null, React.createElement(TourHarness)));
  });
  mounted.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
}

describe("the kitchen-sink tour harness", () => {
  it("gives the Start button back when the tour ends, and replays from the top", async () => {
    await renderHarness();
    expect(control("Start the tour").disabled).toBe(false);

    await click("Start the tour");
    expect(document.querySelector(".tour-coach")?.textContent).toContain("This is the coach card.");
    expect(control("Running").disabled).toBe(true);

    await click("Finish the tour for good");

    expect(document.querySelector(".tour-coach")).toBe(null);
    expect(has("Running")).toBe(false);
    expect(control("Start the tour").disabled).toBe(false);
    // The log is the page's evidence, so ending a run annotates it rather than
    // clearing it — that is Reset's job, and Reset is not what just happened.
    expect(document.body.textContent).toContain("harness rewound");

    // And the second run is a real one: back on step one, not resumed onto the
    // finished cursor the mirror still remembered.
    await click("Start the tour");
    expect(document.querySelector(".tour-coach")?.textContent).toContain("This is the coach card.");
  });

  it("labels the scroll spacer so the page doesn't read as broken before the tour starts", async () => {
    await renderHarness();
    expect(document.body.textContent).toContain("scroll spacer for spotlight testing");
  });
});
