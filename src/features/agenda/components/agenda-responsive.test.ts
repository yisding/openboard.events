import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("agenda workspace responsive styles", () => {
  it("stacks through the admin shell's 860px mobile breakpoint", () => {
    const css = readFileSync(new URL("../../../app/globals.css", import.meta.url), "utf8");
    const marker = "/* The admin shell remains in its mobile form through 860px";
    const markerIndex = css.indexOf(marker);
    const breakpointIndex = css.lastIndexOf("@media(max-width:860px){", markerIndex);
    const breakpointEnd = css.indexOf("\n}", markerIndex);
    const block = css.slice(markerIndex, breakpointEnd);

    expect(markerIndex).toBeGreaterThan(breakpointIndex);
    expect(breakpointIndex).toBeGreaterThanOrEqual(0);
    expect(breakpointEnd).toBeGreaterThan(markerIndex);
    expect(css).toContain(".agenda-workspace{display:grid;grid-template-columns:220px minmax(0,1fr)");
    expect(css).toContain("@media(max-width:1000px){.portal-header nav{margin-left:20px}.portal-header nav a{padding:0 8px}.agenda-workspace{grid-template-columns:180px minmax(0,1fr)}");
    expect(css).toContain(".day-grid{min-width:0;overflow-x:auto}");
    expect(css).toContain(".room-headings{min-width:650px");
    expect(css).toContain(".day-grid-body{min-width:650px");
    expect(block).toContain(".agenda-workspace{display:block}");
    expect(css).toContain("@media(max-width:860px){.dv-layout{grid-template-columns:minmax(0,1fr)}");
    expect(block).toContain(".page:has(.agenda-workspace)>.page-header{display:grid}");
    expect(block).toContain(".agenda-toolbar>div:last-child{display:none}");
    expect(block).toContain(".agenda-workspace>.day-grid{min-width:0;width:100%}");
    expect(block).toContain(".agenda-workspace>.day-grid .dv-grid{min-width:700px}");
    expect(block).toContain(".agenda-lanes{grid-template-columns:1fr}");
    expect(css).toContain("@media(min-width:861px) and (max-width:1200px){");
    expect(css).toContain(".page:has(.agenda-workspace)>.agenda-toolbar{height:auto;min-height:49px;flex-wrap:wrap");
  });
});
