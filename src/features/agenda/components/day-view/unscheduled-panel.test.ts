import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { boardJustCleared } from "./unscheduled-panel";

describe("boardJustCleared", () => {
  it("celebrates only the live transition to an empty tray", () => {
    expect(boardJustCleared(1, 0)).toBe(true);
    expect(boardJustCleared(7, 0)).toBe(true);
  });

  it("stays quiet on load, on partial progress, and when sessions return", () => {
    expect(boardJustCleared(0, 0)).toBe(false);
    expect(boardJustCleared(3, 1)).toBe(false);
    expect(boardJustCleared(0, 4)).toBe(false);
  });

  it("watches the unfiltered count so the search box cannot fake a cleared board", () => {
    const panel = readFileSync(new URL("./unscheduled-panel.tsx", import.meta.url), "utf8");
    const page = readFileSync(new URL("../agenda-page.tsx", import.meta.url), "utf8");

    expect(panel).toContain("const celebrationCount = totalCount ?? sessions.length;");
    expect(panel).toContain("boardJustCleared(previous, celebrationCount)");
    expect(page).toContain("unscheduledTotal: unscheduled(sessions).length");
  });
});

describe("tray rows", () => {
  const panel = readFileSync(new URL("./unscheduled-panel.tsx", import.meta.url), "utf8");

  it("opens the session when the row itself is clicked", () => {
    // Both trays this file renders — Unscheduled and Needs a room — used to
    // answer only the small Edit link, while the panel's hint and the guided
    // tour both told organizers to click the row (#720).
    expect(panel).toContain("useOpenOnClick(isDragging");
    expect(panel).toContain("onPointerDownCapture={openOnClick.onPointerDownCapture}");
    expect(panel).toContain("onClick={openOnClick.onClick}");
  });

  it("keeps the drag onto the grid and the Edit keyboard route", () => {
    // The click handlers sit after `{...listeners}` and share no handler name
    // with them, so dnd-kit's own `onPointerDown` still reaches the row.
    expect(panel).toContain("{...listeners}");
    expect(panel).toContain('className="dv-tray-edit"');
  });
});
