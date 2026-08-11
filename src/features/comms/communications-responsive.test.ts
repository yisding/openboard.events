import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function cssBlockAt(css: string, start: number): string {
  const open = css.indexOf("{", start);
  if (open < 0) throw new Error("CSS block has no opening brace");
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    if (css[index] === "}") depth -= 1;
    if (depth === 0) return css.slice(start, index + 1);
  }
  throw new Error("CSS block has no closing brace");
}

describe("communications activity table responsive styles", () => {
  it("uses the compact readable table through 899px and restores the full table at 900px", () => {
    const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
    const start = css.indexOf("@media(max-width:899px)");

    expect(start).toBeGreaterThanOrEqual(0);
    const tabletBlock = cssBlockAt(css, start);
    expect(tabletBlock).toContain(".comms-table{width:100%!important;table-layout:fixed}");
    expect(tabletBlock).toContain(".comms-table th:nth-child(3),.comms-table td:nth-child(3),.comms-table th:nth-child(5),.comms-table td:nth-child(5){display:none}");
    expect(tabletBlock).toContain(".comms-table th:first-child{width:38%}");
    expect(tabletBlock).toContain(".comms-table th:nth-child(4){width:68px}");
    expect(tabletBlock).toContain(".comms-table th:last-child{width:48px}");
    expect(tabletBlock).toContain(".comms-table .submission-title-cell b,.comms-table .submission-title-cell span{white-space:nowrap}");
    expect(css).not.toContain("@media(max-width:900px)");
  });
});
