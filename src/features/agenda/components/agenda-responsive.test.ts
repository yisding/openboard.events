import { readFileSync } from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgendaToolbar } from "./agenda-toolbar";

Object.assign(globalThis, { React });

describe("agenda workspace responsive styles", () => {
  it("stacks through the admin shell's 768px mobile breakpoint", () => {
    const css = readFileSync(new URL("../../../app/globals.css", import.meta.url), "utf8");
    const toolbar = readFileSync(new URL("./agenda-toolbar.tsx", import.meta.url), "utf8");
    const dayView = readFileSync(new URL("./day-view.tsx", import.meta.url), "utf8");
    expect(css).toContain(".agenda-workspace{display:grid;grid-template-columns:220px minmax(0,1fr)");
    expect(css).toContain(".agenda-workspace{grid-template-columns:180px minmax(0,1fr)}");
    expect(css).toContain(".day-grid{min-width:0;overflow-x:auto}");
    expect(css).toContain(".room-headings{min-width:650px");
    expect(css).toContain(".day-grid-body{min-width:650px");
    expect(css).toContain(".agenda-daybar{min-width:0;overflow:hidden;gap:12px}");
    expect(css).toContain(".agenda-view-tabs{height:55px;min-height:55px;align-self:flex-start}");
    expect(css).toContain(".agenda-daybar>.agenda-daybar-scroll{min-width:0;flex:1;display:flex;height:100%;overflow-x:auto");
    expect(toolbar).toContain('className="button button-secondary button-sm agenda-invited-link"');
    expect(toolbar).toContain('className="agenda-toolbar-actions"');
    expect(dayView).not.toContain("<DayTabs");
    expect(css).not.toContain(".dv-day-tabs");
    expect(css).toContain("@media(max-width:1024px){\n  .dv-layout{grid-template-columns:minmax(0,1fr)}");
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
    expect(css).not.toMatch(/\.accepted-tray(?:\s*>?\s*)(?:button|div|span)\b/gu);
    expect(css).not.toContain(".accepted-tray .button");
    expect(css).toContain(".button, .button-sm, .button-lg { min-height: 44px; }");
    // The toolbar's second row used to be expressed as a `(min-width:769px) and
    // (max-width:1200px)` band. T5 allows only max-width:480/768/1024/1280, so
    // the band is now a ≤1024 wrap plus a ≤768 mobile reflow that keeps every
    // action reachable. Assert both halves, and that no min-width or
    // range-syntax query has crept back in.
    expect(css).toContain(".page:has(.agenda-workspace)>.agenda-toolbar{height:auto;min-height:57px;flex-wrap:wrap");
    expect(css).toContain(".page:has(>.agenda-toolbar)>.agenda-toolbar{height:auto;min-height:57px;flex-wrap:wrap");
    // Match only the query preludes, not the prose in the comment that records
    // why the band was folded.
    const preludes = css.match(/@media[^{]*/g) ?? [];
    expect(preludes.filter((prelude) => /min-width|1200px|899px|769px/.test(prelude))).toEqual([]);
  });

  it("uses one contained day rail and aligns both creation actions", () => {
    const html = renderToStaticMarkup(React.createElement(AgendaToolbar, {
      view: "day",
      day: "2026-08-12",
      conflictCount: 0,
      event: {
        timezone: "UTC",
        startsAt: "2026-08-12T09:00:00.000Z",
        endsAt: "2026-08-24T00:00:00.000Z",
      },
      search: "",
      onSearch: () => undefined,
      onView: () => undefined,
      onDay: () => undefined,
      onCreate: () => undefined,
      eventId: "11111111-1111-4111-8111-111111111111",
    }));

    expect(html.match(/aria-pressed=/gu)).toHaveLength(12);
    expect(html).not.toContain(">All<");
    expect(html).toContain('class="agenda-daybar-scroll" role="group" aria-label="Event day"');
    expect(html).toContain("button button-secondary button-sm agenda-invited-link");
    expect(html).toContain("Add invited talk</a>");
    expect(html).toContain("Add session</button>");
  });

  it("turns unresolved conflicts into an amber tab and a direct review action", () => {
    const html = renderToStaticMarkup(React.createElement(AgendaToolbar, {
      view: "day",
      day: "2026-08-12",
      conflictCount: 2,
      event: {
        timezone: "UTC",
        startsAt: "2026-08-12T09:00:00.000Z",
        endsAt: "2026-08-12T18:00:00.000Z",
      },
      search: "",
      onSearch: () => undefined,
      onView: () => undefined,
      onDay: () => undefined,
      onCreate: () => undefined,
      eventId: "11111111-1111-4111-8111-111111111111",
    }));

    expect(html).toContain('class="has-conflicts"');
    expect(html).toContain('class="agenda-conflict-banner"');
    expect(html).toContain("2 scheduling conflicts</b> need attention before you publish.");
    expect(html).toContain("Review conflicts");
  });
});
