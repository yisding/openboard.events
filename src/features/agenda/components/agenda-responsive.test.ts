import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("agenda workspace responsive styles", () => {
  it("stacks through the admin shell's 768px mobile breakpoint", () => {
    const css = readFileSync(new URL("../../../app/globals.css", import.meta.url), "utf8");
    expect(css).toContain(".agenda-workspace{display:grid;grid-template-columns:220px minmax(0,1fr)");
    expect(css).toContain(".agenda-workspace{grid-template-columns:180px minmax(0,1fr)}");
    expect(css).toContain(".day-grid{min-width:0;overflow-x:auto}");
    expect(css).toContain(".room-headings{min-width:650px");
    expect(css).toContain(".day-grid-body{min-width:650px");
    expect(css).toContain("@media(max-width:1200px){.dv-layout{grid-template-columns:minmax(0,1fr)}");
    expect(css).toContain(".agenda-workspace{display:block}");
    expect(css).toContain(".agenda-toolbar>div:last-child{display:none}");
    expect(css).toContain(".agenda-workspace>.day-grid{min-width:0;width:100%}");
    expect(css).toContain(".agenda-workspace>.day-grid .dv-grid{min-width:700px}");
    expect(css).toContain(".agenda-lanes{grid-template-columns:1fr}");
    expect(css).toContain("@media(min-width:769px) and (max-width:1200px){");
    expect(css).toContain(".page:has(.agenda-workspace)>.agenda-toolbar{height:auto;min-height:49px;flex-wrap:wrap");
  });
});
