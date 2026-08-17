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
    // organizer asked for. `dragged` is fed by the whole DndContext, so a
    // resize that dragged the card's own strip back to where it started — the
    // one gesture the distance check alone would call a click — lands here too.
    expect(isClickNotDrag(press, press, true)).toBe(false);
    expect(isClickNotDrag(press, { x: 640, y: 300 }, true)).toBe(false);
  });

  it("refuses a release past the sensor's activation distance", () => {
    expect(isClickNotDrag(press, { x: press.x + CLICK_SLOP_PX + 1, y: press.y }, false)).toBe(false);
    expect(isClickNotDrag(press, { x: press.x + 40, y: press.y + 40 }, false)).toBe(false);
  });

  it("refuses a release with no recorded press", () => {
    // Every pointer press inside the drag source records an origin in the
    // capture phase, so a `click` with none behind it was synthesized rather
    // than pressed. The keyboard route is the card's own Enter/Space handler.
    expect(isClickNotDrag(null, press, false)).toBe(false);
  });

  it("watches every drag in the context, not just the card's own", () => {
    // The resize strips are sibling draggables: the card's `isDragging` stays
    // false right through a resize, so `active` is what makes a resize count.
    const hook = readFileSync(new URL("./click-to-open.ts", import.meta.url), "utf8");
    expect(hook).toContain("const { active } = useDndContext();");
    expect(hook).toContain("if (isDragging || active !== null) dragged.current = true;");
  });

  it("stays in step with the DndContext's activation distance", () => {
    // Two different numbers here would produce a dead zone (a press that starts
    // a drag but still reads as a click, or the reverse).
    const dayView = readFileSync(new URL("../day-view.tsx", import.meta.url), "utf8");
    expect(dayView).toContain(`activationConstraint: { distance: ${CLICK_SLOP_PX} }`);
  });
});
