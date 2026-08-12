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
  it("uses the compact readable table through 1024px and restores the full table above it", () => {
    const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
    // The compact table used to live in a `max-width:899px` query. T5 allows
    // only 480/768/1024/1280, so it now sits in the ≤1024 block. There are
    // several ≤1024 blocks, so anchor on a rule unique to this one and walk
    // back to the query that opens it rather than taking the first match.
    const anchor = css.indexOf(".comms-table{width:100%!important;table-layout:fixed}");
    expect(anchor).toBeGreaterThanOrEqual(0);
    const start = css.lastIndexOf("@media", anchor);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(css.startsWith("@media(max-width:1024px)", start)).toBe(true);

    const tabletBlock = cssBlockAt(css, start);
    expect(tabletBlock).toContain(".comms-table{width:100%!important;table-layout:fixed}");
    expect(tabletBlock).toContain(".comms-table th:nth-child(3),.comms-table td:nth-child(3),.comms-table th:nth-child(5),.comms-table td:nth-child(5){display:none}");
    expect(tabletBlock).toContain(".comms-table th:first-child{width:38%}");
    expect(tabletBlock).toContain(".comms-table th:nth-child(4){width:68px}");
    expect(tabletBlock).toContain(".comms-table th:last-child{width:48px}");
    expect(tabletBlock).toContain(".comms-table .submission-title-cell b,.comms-table .submission-title-cell span{white-space:nowrap}");
    expect(css).not.toContain("@media(max-width:899px)");
    expect(css).not.toContain("@media(max-width:900px)");
  });

  it("keeps communications checkboxes compact instead of inheriting full-width text-input sizing", () => {
    const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
    expect(css).toContain(".checkbox-row input[type=\"checkbox\"]{width:16px;height:16px;min-width:16px;min-height:16px;flex:0 0 16px");
    expect(css).toContain(".bulk-send-checkboxes .checkbox-row:has(input:checked)");
  });

  it("stacks the reminder editor and its actions at the canonical mobile breakpoint", () => {
    const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
    const tabletAnchor = css.lastIndexOf(".reminder-rules-editor .reminder-rule{grid-template-columns:minmax(0,1fr) 160px}");
    const anchor = css.lastIndexOf(".reminder-rules-editor .reminder-rule{grid-template-columns:1fr}");
    expect(anchor).toBeGreaterThanOrEqual(0);
    expect(anchor).toBeGreaterThan(tabletAnchor);
    const start = css.lastIndexOf("@media", anchor);
    expect(css.startsWith("@media(max-width:768px)", start)).toBe(true);
    const actionsAnchor = css.indexOf(".template-editor-actions{align-items:stretch;flex-direction:column}");
    const actionsStart = css.lastIndexOf("@media", actionsAnchor);
    expect(css.startsWith("@media(max-width:768px)", actionsStart)).toBe(true);
  });

  it("scopes the two-column reminder grid away from the three-child demo cards", () => {
    const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
    const source = readFileSync(new URL("./components/reminders-tab.tsx", import.meta.url), "utf8");
    expect(source).toContain('className="panel reminder-rules reminder-rules-editor"');
    expect(css).toContain(".reminder-rules-editor .reminder-rule{display:grid;grid-template-columns:minmax(0,1fr) 180px");
    expect(css).not.toContain(".reminder-rule{padding:16px;display:grid");
  });

  it("gives the credential-free templates and reminder ladder deliberate card layouts", () => {
    const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
    const source = readFileSync(new URL("./communications-page.tsx", import.meta.url), "utf8");
    expect(source).toContain('className="panel communication-template-card"');
    expect(source).toContain("reminder-rule reminder-rule-demo");
    expect(source).toContain('<Switch label="Enable reminder ladder"');
    expect(css).toContain(".communication-template-card{min-height:258px;display:flex;flex-direction:column;overflow:hidden}");
    expect(css).toContain(".reminder-rule-demo{min-height:76px;display:grid;grid-template-columns:34px minmax(0,1fr) auto");
  });

  it("gives the section switcher complete tab semantics and keyboard movement", () => {
    const source = readFileSync(new URL("./components/comms-admin-page.tsx", import.meta.url), "utf8");
    expect(source).toContain('role="tablist"');
    expect(source).toContain('role="tabpanel"');
    expect(source).toContain("tabIndex={tab === entry.id ? 0 : -1}");
    expect(source).toContain('event.key === "ArrowRight"');
    expect(source).toContain('event.key === "ArrowLeft"');
  });
});
