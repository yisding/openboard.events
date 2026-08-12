import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("embeds admin layout", () => {
  const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
  const source = readFileSync(new URL("./embeds-admin-page.tsx", import.meta.url), "utf8");

  it("resets filter checkboxes to compact glyphs with mobile-sized label hit areas", () => {
    expect(css).toContain(".embed-filter-group input[type=\"checkbox\"]{width:15px;height:15px;min-width:15px;min-height:15px;flex:0 0 15px");
    expect(css).toMatch(/@media\(max-width:768px\)[\s\S]*\.embed-filter-group label\{min-height:44px\}/u);
  });

  it("groups each embed into appearance, content, filters, save, and install regions", () => {
    expect(source).toContain('className="embed-settings-grid"');
    expect(source).toContain('className="embed-filters-section"');
    expect(source).toContain('className="embed-save-row"');
    expect(source).toContain('className="embed-install-section"');
    expect(css).toContain(".embed-settings-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))");
  });

  it("opens one editor at a time so five embed types do not become one enormous form", () => {
    expect(source).toContain("const [openConfigId, setOpenConfigId]");
    expect(source).toContain("const open = openConfigId === config.id");
    expect(source).toContain("setOpenConfigId(open ? null : config.id)");
    expect(source).toContain("aria-expanded={open}");
  });

  it("reports clipboard failures instead of claiming a copy succeeded", () => {
    expect(source).toContain("await navigator.clipboard.writeText(value)");
    expect(source).toContain("setManualCopy({ contentType, label, value })");
    expect(source).toContain('className="embed-manual-copy" role="alert"');
    expect(source).toContain("readOnly");
    expect(source).toContain("value={manualCopy.value}");
    expect(source).toContain('toast("Copy failed — use the manual copy field below", { kind: "error" })');
  });
});
