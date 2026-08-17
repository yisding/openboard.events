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
    expect(left).toBeGreaterThanOrEqual(12);
    expect(left + POPOVER_WIDTH).toBeLessThanOrEqual(cramped.width);
    // Ten pixels of viewport left below the anchor, so the panel goes above it
    // rather than being clamped down onto the control it points at.
    expect(style.top).toBeUndefined();
    expect(Number(style.bottom)).toBe(cramped.height - 440 + 10);
  });

  it("opens a left-placed panel clear of the anchor's leading edge", () => {
    const style = popoverPosition("left", { top: 300, right: 900, bottom: 340, left: 700 }, viewport);
    expect(style).toEqual({ left: 700 - POPOVER_WIDTH - 10, top: 292 });
  });

  it("pins the far edge when opening above an anchor, so any height clears it", () => {
    // Not `top: anchor.top - clearance`: the clearance is an estimate, and a
    // panel taller than the estimate would be drawn over the control it is
    // pointing at.
    const style = popoverPosition("top", { top: 640, right: 500, bottom: 680, left: 400 }, viewport);
    expect(style).toEqual({ left: 400, bottom: viewport.height - 640 + 10 });
  });

  it("opens a left-placed panel to the right when its own side has no room", () => {
    // Clamping to the leading margin used to park the panel on top of the
    // anchor — which for the tour is the control the player is being asked to
    // click next.
    const style = popoverPosition("left", { top: 120, right: 120, bottom: 150, left: 40 }, viewport);
    expect(style).toEqual({ left: 130, top: 112 });
  });

  it("opens a top-placed panel below its anchor when there is no room above it", () => {
    // Clamping to the top margin used to leave the panel overlapping the very
    // control it points at, from the other side.
    const style = popoverPosition("top", { top: 60, right: 500, bottom: 92, left: 400 }, viewport);
    expect(style).toEqual({ left: 400, top: 102 });
  });

  it("opens a bottom-placed panel above its anchor when there is no room below it", () => {
    const style = popoverPosition("bottom", { top: 600, right: 500, bottom: 700, left: 400 }, viewport);
    expect(style).toEqual({ left: 400, bottom: viewport.height - 600 + 10 });
  });

  it("stays inside the viewport when neither side of the anchor has room", () => {
    // A tall anchor in a short window: there is nowhere good, so the old
    // clamp is still the answer — the panel scrolls, and it is on screen.
    const style = popoverPosition("bottom", { top: 190, right: 500, bottom: 620, left: 400 }, viewport);
    expect(style).toEqual({ left: 400, top: viewport.height - POPOVER_CLEARANCE });
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

  it("measures the room below against the panel's own clearance", () => {
    // 40px of window under the anchor and a 300px card: the coach card goes
    // above the control rather than being clamped down over it.
    const style = popoverPosition("bottom", { top: 700, right: 500, bottom: 760, left: 400 }, viewport, { clearance: 300 });
    expect(style).toEqual({ left: 400, bottom: 800 - 700 + 10 });
  });
});
