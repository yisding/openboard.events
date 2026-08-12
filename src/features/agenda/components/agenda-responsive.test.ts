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
    expect(css).toContain("@media(max-width:1024px){.dv-layout{grid-template-columns:minmax(0,1fr)}");
    expect(css).toContain(".agenda-workspace{display:block}");
    expect(css).toContain(".agenda-workspace>.day-grid{min-width:0;width:100%}");
    expect(css).toContain(".agenda-workspace>.day-grid .dv-grid{min-width:700px}");
    expect(css).toContain(".agenda-lanes{grid-template-columns:1fr}");
    // The compact rule earlier in the sheet used to end the organizer's flow by
    // hiding all search/create controls and accepted submissions. The later
    // mobile rules must explicitly restore both surfaces after that declaration.
    const hiddenActions = css.indexOf(".agenda-toolbar>div:last-child{display:none}");
    const restoredActions = css.indexOf(".agenda-toolbar>div:last-child{display:flex;width:100%", hiddenActions + 1);
    const hiddenAccepted = css.indexOf(".accepted-tray{display:none}");
    const restoredAccepted = css.indexOf(".accepted-tray{display:flex;flex:0 0 auto", hiddenAccepted + 1);
    expect(hiddenActions).toBeGreaterThan(-1);
    expect(restoredActions).toBeGreaterThan(hiddenActions);
    expect(hiddenAccepted).toBeGreaterThan(-1);
    expect(restoredAccepted).toBeGreaterThan(hiddenAccepted);
    expect(css).toContain(".accepted-tray button{width:44px;height:44px}");
    // The toolbar's second row used to be expressed as a `(min-width:769px) and
    // (max-width:1200px)` band. T5 allows only max-width:480/768/1024/1280, so
    // the band is now a ≤1024 wrap plus a ≤768 mobile reflow that keeps every
    // action reachable. Assert both halves, and that no min-width or
    // range-syntax query has crept back in.
    expect(css).toContain(".page:has(.agenda-workspace)>.agenda-toolbar{height:auto;min-height:49px;flex-wrap:wrap");
    expect(css).toContain(".page:has(>.agenda-toolbar)>.agenda-toolbar{height:auto;min-height:49px;flex-wrap:wrap");
    // Match only the query preludes, not the prose in the comment that records
    // why the band was folded.
    const preludes = css.match(/@media[^{]*/g) ?? [];
    expect(preludes.filter((prelude) => /min-width|1200px|899px|769px/.test(prelude))).toEqual([]);
  });
});
