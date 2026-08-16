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
  it("discloses the activity log's columns progressively at the canonical breakpoints", () => {
    const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
    // The ladder used to live in a `max-width:899px` query. T5 allows only
    // 480/768/1024/1280, so it now sits in the ≤1024 and ≤768 blocks. There
    // are several of each, so anchor on a rule unique to this one and walk
    // back to the query that opens it rather than taking the first match.
    // The class hooks themselves are guarded against deletion by
    // components/comms-log-table.test.tsx, which renders the real table.
    const tabletAnchor = css.indexOf(".data-table th.comms-log-col-provider");
    expect(tabletAnchor).toBeGreaterThanOrEqual(0);
    const tabletStart = css.lastIndexOf("@media", tabletAnchor);
    expect(css.startsWith("@media (max-width: 1024px)", tabletStart)).toBe(true);
    const tabletBlock = cssBlockAt(css, tabletStart);
    expect(tabletBlock).toContain(".data-table td.comms-log-col-provider");
    expect(tabletBlock).toContain(".data-table td.comms-log-col-created");
    // Subject is the widest cell in the row, so it leaves at the same rung
    // rather than squeezing the recipient — and it is capped, not free, on the
    // desktop rung above, or one long reminder subject sets the whole layout.
    expect(tabletBlock).toContain(".data-table td.comms-log-col-subject");
    expect(css).toContain(".data-table td.comms-log-col-subject>span{display:block;max-width:");
    // Recipient, Template, Status and Sent survive the tablet step.
    expect(tabletBlock).not.toContain("comms-log-col-recipient");
    expect(tabletBlock).not.toContain("comms-log-col-template");
    expect(tabletBlock).not.toContain("comms-log-col-sent");

    const mobileAnchor = css.indexOf(".data-table th.comms-log-col-template");
    expect(mobileAnchor).toBeGreaterThanOrEqual(0);
    const mobileStart = css.lastIndexOf("@media", mobileAnchor);
    expect(css.startsWith("@media (max-width: 768px)", mobileStart)).toBe(true);
    const mobileBlock = cssBlockAt(css, mobileStart);
    // The shared 240px floor alone is wider than the phone column the row has
    // to fit in, so the recipient cell must escape it here — and escape it with
    // a *cap*, not `max-width:none`. `overflow:hidden` never shrinks a box's
    // intrinsic width, so a nowrap address kept asking an auto-layout table for
    // its full measured width and the row grew past `.table-scroll` instead of
    // ellipsising.
    expect(mobileBlock).toContain(".data-table td.comms-log-col-recipient .submission-title-cell { min-width: 0;");
    expect(mobileBlock).toContain("max-width: clamp(");
    expect(mobileBlock).not.toContain("max-width: none");

    // ≤480 is the ladder's last rung: at 390px the 44px selection column, three
    // cells of padding, the recipient and the status chip already fill the row,
    // so the send time — which the row's detail drawer repeats — goes.
    const phoneAnchor = css.indexOf(".data-table th.comms-log-col-sent");
    expect(phoneAnchor).toBeGreaterThanOrEqual(0);
    const phoneStart = css.lastIndexOf("@media", phoneAnchor);
    expect(css.startsWith("@media (max-width: 480px)", phoneStart)).toBe(true);
    expect(cssBlockAt(css, phoneStart)).toContain(".data-table td.comms-log-col-sent { display: none; }");

    // Status is never hidden: it is what the tab exists to show.
    expect(css).not.toContain("comms-log-col-status");
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
    const tabletAnchor = css.lastIndexOf(".reminder-rules-editor .reminder-rule{grid-template-columns:minmax(0,1fr) 160px auto}");
    const anchor = css.lastIndexOf(".reminder-rules-editor .reminder-rule{grid-template-columns:1fr}");
    expect(anchor).toBeGreaterThanOrEqual(0);
    expect(anchor).toBeGreaterThan(tabletAnchor);
    const start = css.lastIndexOf("@media", anchor);
    expect(css.startsWith("@media(max-width:768px)", start)).toBe(true);
    const actionsAnchor = css.indexOf(".template-editor-actions{align-items:stretch;flex-direction:column}");
    const actionsStart = css.lastIndexOf("@media", actionsAnchor);
    expect(css.startsWith("@media(max-width:768px)", actionsStart)).toBe(true);
  });

  it("stacks message previews before the desktop sidebar crowds the compose form", () => {
    const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
    const anchor = css.indexOf("@media(max-width:1280px){.template-editor-grid{grid-template-columns:1fr}.template-editor__preview{position:static;max-height:none}}");
    expect(anchor).toBeGreaterThanOrEqual(0);
  });

  it("scopes the two-column reminder grid away from the three-child demo cards", () => {
    const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
    const source = readFileSync(new URL("./components/reminders-tab.tsx", import.meta.url), "utf8");
    expect(source).toContain('className="panel reminder-rules reminder-rules-editor"');
    expect(css).toContain(".reminder-rules-editor .reminder-rule{display:grid;grid-template-columns:minmax(0,1fr) 180px");
    expect(css).not.toContain(".reminder-rule{padding:16px;display:grid");
  });

  it("gives the section switcher complete tab semantics and keyboard movement", () => {
    const source = readFileSync(new URL("./components/comms-admin-page.tsx", import.meta.url), "utf8");
    expect(source).toContain('role="tablist"');
    expect(source).toContain('role="tabpanel"');
    expect(source).toContain("tabIndex={tab === entry.id ? 0 : -1}");
    expect(source).toContain("moveRovingTab(event, TAB_IDS, entry.id, selectTab)");
  });
});
