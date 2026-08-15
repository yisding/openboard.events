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
