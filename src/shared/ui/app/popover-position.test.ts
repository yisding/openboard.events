import { describe, expect, it } from "vitest";
import { POPOVER_CLEARANCE, POPOVER_WIDTH, popoverPosition } from "./popover-position";

const viewport = { width: 1280, height: 800 };

/* The first three cases arrived with the function from `first-run-hints`, and
   are kept byte-for-byte identical in expectation: the extraction is only
   honest if the ambient hint card still opens exactly where it used to. */
describe("popover placement", () => {
  it("opens to the right of a sidebar beacon, roughly top-aligned", () => {
    const style = popoverPosition("right", { top: 200, right: 230, bottom: 224, left: 206 }, viewport);
    expect(style).toEqual({ left: 240, top: 192 });
  });

  it("right-aligns a bottom-end card under its anchor", () => {
    const style = popoverPosition("bottom-end", { top: 20, right: 1240, bottom: 52, left: 1100 }, viewport);
    expect(style).toEqual({ left: 1240 - 264, top: 62 });
  });

  it("never leaves the viewport, even for anchors at the edges", () => {
    const cramped = { width: 320, height: 480 };
    const style = popoverPosition("bottom", { top: 440, right: 316, bottom: 470, left: 300 }, cramped);
    const left = Number(style.left);
    const top = Number(style.top);
    expect(left).toBeGreaterThanOrEqual(12);
    expect(left + POPOVER_WIDTH).toBeLessThanOrEqual(cramped.width);
    expect(top).toBeLessThanOrEqual(cramped.height - POPOVER_CLEARANCE);
  });

  it("opens a left-placed panel clear of the anchor's leading edge", () => {
    const style = popoverPosition("left", { top: 300, right: 900, bottom: 340, left: 700 }, viewport);
    expect(style).toEqual({ left: 700 - POPOVER_WIDTH - 10, top: 292 });
  });

  it("reserves the panel's own clearance when opening above an anchor", () => {
    const style = popoverPosition("top", { top: 640, right: 500, bottom: 680, left: 400 }, viewport);
    expect(style).toEqual({ left: 400, top: 640 - POPOVER_CLEARANCE - 10 });
  });

  it("clamps a left-placed panel rather than pushing it off the leading edge", () => {
    const style = popoverPosition("left", { top: 120, right: 120, bottom: 150, left: 40 }, viewport);
    expect(style.left).toBe(12);
  });

  it("clamps a top-placed panel to the top margin when the anchor is near the top", () => {
    const style = popoverPosition("top", { top: 60, right: 500, bottom: 92, left: 400 }, viewport);
    expect(style.top).toBe(12);
  });
});

describe("wider panels", () => {
  // The coach card is 320px, not the hint's 264 — so the right-hand clamp has
  // to move with it or the tour's card hangs off the edge next to a topbar
  // control that the hint card would have cleared.
  it("clamps to the panel's own width", () => {
    const style = popoverPosition("bottom", { top: 20, right: 1270, bottom: 52, left: 1200 }, viewport, { width: 320 });
    expect(style.left).toBe(1280 - 320 - 12);
  });

  it("clamps to the panel's own clearance", () => {
    const style = popoverPosition("bottom", { top: 700, right: 500, bottom: 760, left: 400 }, viewport, { clearance: 300 });
    expect(style.top).toBe(800 - 300);
  });
});
