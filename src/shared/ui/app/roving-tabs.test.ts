/** @vitest-environment happy-dom */
import type { KeyboardEvent } from "react";
import { describe, expect, it } from "vitest";
import { moveRovingTab } from "./roving-tabs";

const TABS = ["templates", "reminders", "log"] as const;

function strip(): HTMLElement[] {
  document.body.innerHTML = `<div role="tablist">${TABS
    .map((id, index) => `<button role="tab" id="tab-${id}" tabindex="${index === 0 ? 0 : -1}"></button>`)
    .join("")}</div>`;
  return [...document.querySelectorAll<HTMLElement>('[role="tab"]')];
}

function arrowRight(from: HTMLElement): KeyboardEvent<HTMLElement> {
  return { key: "ArrowRight", currentTarget: from, preventDefault: () => undefined } as unknown as KeyboardEvent<HTMLElement>;
}

describe("moveRovingTab", () => {
  it("moves focus with the selection", () => {
    const tabs = strip();
    const first = tabs[0];
    const second = tabs[1];
    if (!first || !second) throw new Error("fixture strip is missing tabs");
    first.focus();

    const picked: string[] = [];
    moveRovingTab(arrowRight(first), TABS, "templates", (next) => { picked.push(next); });

    expect(picked).toEqual(["reminders"]);
    expect(document.activeElement).toBe(second);
  });

  // The comms strip defers to the unsaved-work guard, which may refuse the
  // switch. Moving focus anyway leaves the ring on a tab that is neither
  // selected nor the strip's tab stop.
  it("leaves focus where it is when the selection is refused", () => {
    const tabs = strip();
    const first = tabs[0];
    if (!first) throw new Error("fixture strip is missing tabs");
    first.focus();

    moveRovingTab(arrowRight(first), TABS, "templates", () => false);

    expect(document.activeElement).toBe(first);
  });
});
