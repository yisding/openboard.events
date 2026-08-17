import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isCompactSession } from "./session-card";

describe("isCompactSession", () => {
  it("uses the concise time-and-title layout through the 45-minute boundary", () => {
    expect(isCompactSession(15)).toBe(true);
    expect(isCompactSession(44)).toBe(true);
    expect(isCompactSession(45)).toBe(true);
    expect(isCompactSession(46)).toBe(false);
    expect(isCompactSession(60)).toBe(false);
  });
});

describe("opening a placed session", () => {
  const card = readFileSync(new URL("./session-card.tsx", import.meta.url), "utf8");

  it("opens the editor on a single click, past the drag guard", () => {
    // Double-click used to be the only pointer route in, and nothing on screen
    // said so (#720). A single click opens it; `useOpenOnClick` is what keeps a
    // finished drag from opening the dialog on top of the move.
    expect(card).toContain("useOpenOnClick(isDragging");
    expect(card).toContain("onClick={openOnClick.onClick}");
    expect(card).toContain("openOnClick.onPointerDown(pointerEvent)");
  });

  it("keeps the pointer drag and the keyboard route it already had", () => {
    // The click handlers sit after `{...listeners}`, so chaining dnd-kit's own
    // pointerdown is the only thing keeping drag-to-move alive.
    expect(card).toContain("listeners?.onPointerDown?.(pointerEvent)");
    expect(card).toContain("onDoubleClick={() => onEdit?.(String(session.id))}");
    expect(card).toContain("press Enter to edit");
    expect(card).toContain("if (keyEvent.target !== keyEvent.currentTarget) return;");
  });
});
