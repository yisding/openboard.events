import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { FirstRunHints, Hint, hintPopoverPosition, hintSkipKey, hintStorageKey, readSeenHintIds } from "./first-run-hints";

Object.assign(globalThis, { React });

const IDS = ["shell:a", "shell:b"] as const;

/** A window with just enough localStorage for `readSeenHintIds`. */
function stubWindow(stored: Record<string, string>) {
  Object.assign(globalThis, { window: { localStorage: { getItem: (key: string) => stored[key] ?? null } } });
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("hint seen-state storage", () => {
  it("uses the openboard: key convention MilestoneBanner established", () => {
    expect(hintStorageKey("shell:command-palette")).toBe("openboard:hint-seen:shell:command-palette");
    expect(hintSkipKey("shell")).toBe("openboard:hints-skipped:shell");
  });

  it("treats every hint as seen where there is no storage to consult", () => {
    // Node/server pass: `window` is undefined, and "show nothing" is the safe
    // answer — the client re-reads on mount.
    expect(readSeenHintIds("shell", [...IDS])).toEqual(new Set(IDS));
  });

  it("reads per-hint acknowledgments", () => {
    stubWindow({ [hintStorageKey("shell:a")]: "1" });
    expect(readSeenHintIds("shell", [...IDS])).toEqual(new Set(["shell:a"]));
  });

  it("lets one scoped skip key silence hints that did not exist when it was written", () => {
    stubWindow({ [hintSkipKey("shell")]: "1" });
    expect(readSeenHintIds("shell", ["shell:a", "shell:b", "shell:added-later"])).toEqual(
      new Set(["shell:a", "shell:b", "shell:added-later"]),
    );
  });
});

describe("hint popover placement", () => {
  const viewport = { width: 1280, height: 800 };

  it("opens to the right of a sidebar beacon, roughly top-aligned", () => {
    const style = hintPopoverPosition("right", { top: 200, right: 230, bottom: 224, left: 206 }, viewport);
    expect(style).toEqual({ left: 240, top: 192 });
  });

  it("right-aligns a bottom-end card under its anchor", () => {
    const style = hintPopoverPosition("bottom-end", { top: 20, right: 1240, bottom: 52, left: 1100 }, viewport);
    expect(style).toEqual({ left: 1240 - 264, top: 62 });
  });

  it("never leaves the viewport, even for anchors at the edges", () => {
    const cramped = { width: 320, height: 480 };
    const style = hintPopoverPosition("bottom", { top: 440, right: 316, bottom: 470, left: 300 }, cramped);
    const left = Number(style.left);
    const top = Number(style.top);
    expect(left).toBeGreaterThanOrEqual(12);
    expect(left + 264).toBeLessThanOrEqual(cramped.width);
    expect(top).toBeLessThanOrEqual(cramped.height - 190);
  });
});

describe("hint rendering", () => {
  it("draws no beacon on the server pass, only the wrapped UI", () => {
    // useEffect never runs under static rendering, so `seen` stays null —
    // exactly the state the browser's first paint hydrates against.
    const html = renderToStaticMarkup(
      <FirstRunHints scope="test" ids={[...IDS]}>
        <Hint id="shell:a" title="Tip title" body="Tip body">
          <button type="button">Anchor</button>
        </Hint>
      </FirstRunHints>,
    );
    expect(html).toContain(">Anchor</button>");
    expect(html).toContain("hint-anchor");
    expect(html).not.toContain("hint-beacon");
    expect(html).not.toContain("Tip title");
  });

  it("degrades to a plain wrapper outside a provider", () => {
    const html = renderToStaticMarkup(
      <Hint id="shell:a" title="Tip title" body="Tip body">
        <button type="button">Anchor</button>
      </Hint>,
    );
    expect(html).toBe('<button type="button">Anchor</button>');
  });
});
