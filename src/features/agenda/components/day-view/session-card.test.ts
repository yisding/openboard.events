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
  });

  it("records the press in the phase a resize strip cannot swallow", () => {
    // `ResizeHandles` stops the native pointerdown from bubbling, and its two
    // 6px strips cover all but ~2px of a 15-minute block (16px row, 1px
    // margins). A bubble-phase press handler would leave the shortest sessions
    // with no clickable middle at all, so the capture phase is load-bearing —
    // it is the only one that runs before the strip stops anything.
    expect(card).toContain("onPointerDownCapture={openOnClick.onPointerDownCapture}");
    expect(card).not.toContain("onPointerDown={");
  });

  it("keeps the pointer drag and the keyboard route it already had", () => {
    // The click handlers sit after `{...listeners}` and share no handler name
    // with them, so dnd-kit's own `onPointerDown` still reaches the card.
    expect(card).toContain("{...listeners}");
    expect(card).toContain("onDoubleClick={() => onEdit?.(String(session.id))}");
    expect(card).toContain("press Enter to edit");
    expect(card).toContain("if (keyEvent.target !== keyEvent.currentTarget) return;");
  });
});
