import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CLICK_SLOP_PX, isClickNotDrag } from "./click-to-open";

const press = { x: 200, y: 140 };

describe("isClickNotDrag", () => {
  it("treats a press released where it started as a click", () => {
    expect(isClickNotDrag(press, press, false)).toBe(true);
    expect(isClickNotDrag(press, { x: 203, y: 142 }, false)).toBe(true);
  });

  it("refuses anything dnd-kit reported as a drag, wherever it was released", () => {
    // A block dragged one room across and dropped back over its own card still
    // fires a click; opening the editor on top of the move is not what the
    // organizer asked for.
    expect(isClickNotDrag(press, press, true)).toBe(false);
    expect(isClickNotDrag(press, { x: 640, y: 300 }, true)).toBe(false);
  });

  it("refuses a release past the sensor's activation distance", () => {
    expect(isClickNotDrag(press, { x: press.x + CLICK_SLOP_PX + 1, y: press.y }, false)).toBe(false);
    expect(isClickNotDrag(press, { x: press.x + 40, y: press.y + 40 }, false)).toBe(false);
  });

  it("refuses a release with no recorded press — the resize-handle path", () => {
    // `ResizeHandles` stops the pointerdown from reaching the card, so a resize
    // released over the card arrives with no origin and must not open a dialog.
    expect(isClickNotDrag(null, press, false)).toBe(false);
  });

  it("stays in step with the DndContext's activation distance", () => {
    // Two different numbers here would produce a dead zone (a press that starts
    // a drag but still reads as a click, or the reverse).
    const dayView = readFileSync(new URL("../day-view.tsx", import.meta.url), "utf8");
    expect(dayView).toContain(`activationConstraint: { distance: ${CLICK_SLOP_PX} }`);
  });
});
