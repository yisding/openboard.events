import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("embeds admin layout", () => {
  const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
  const source = readFileSync(new URL("./embeds-admin-page.tsx", import.meta.url), "utf8");

  it("resets filter checkboxes to compact glyphs with mobile-sized label hit areas", () => {
    expect(css).toContain(".embed-filter-group input[type=\"checkbox\"]{width:15px;height:15px;min-width:15px;min-height:15px;flex:0 0 15px");
    expect(css).toMatch(/@media\(max-width:768px\)[\s\S]*\.embed-filter-group label\{min-height:44px\}/u);
  });

  it("groups each embed into compact controls, preview, install, and save state regions", () => {
    expect(source).toContain('className="embed-settings-grid"');
    expect(source).toContain('className="embed-filters-section"');
    expect(source).toContain('className="embed-editor-layout"');
    expect(source).toContain('className="embed-preview-section"');
    expect(source).toContain('className="embed-install-section"');
    expect(css).toContain(".embed-settings-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))");
    expect(css).toContain(".embed-editor-layout{display:grid;grid-template-columns:minmax(0,1fr) 360px");
    expect(css).toContain(".embed-editor-sidebar{position:sticky");
  });

  it("clips card chrome without trapping sticky editor controls in a non-scrolling ancestor", () => {
    expect(css).toContain(".embed-cards>article.embed-card{display:block;padding:0;overflow:clip}");
    expect(css).not.toContain(".embed-cards>article.embed-card{display:block;padding:0;overflow:hidden}");
  });

  it("keeps sticky editor controls below the shared admin topbar", () => {
    expect(css).toContain("--admin-topbar-height: 65px");
    expect(css).toContain(".topbar { position: sticky; z-index: 20; top: 0; height: var(--admin-topbar-height)");
    expect(css).toContain(".embed-editor-bar{position:sticky;z-index:3;top:var(--admin-topbar-height)");
    expect(css).toContain(".embed-editor-sidebar{position:sticky;top:calc(var(--admin-topbar-height) + 62px)");
  });

  it("collapses optional filter groups and summarizes each selection", () => {
    expect(source).toContain('<details className="embed-filter-group">');
    expect(source).toContain('selectedCount > 0 ? `${selectedCount} selected` : "All included"');
    expect(css).toContain(".embed-filter-group summary{");
    expect(css).toContain(".embed-filter-options{max-height:210px;overflow:auto");
  });

  it("opens one editor at a time so five embed types do not become one enormous form", () => {
    expect(source).toContain("const [openConfigId, setOpenConfigId]");
    expect(source).toContain("useState<string | null>(null)");
    expect(source).toContain("const open = openConfigId === config.id");
    expect(source).toContain("setOpenConfigId(open ? null : config.id)");
    expect(source).toContain("aria-expanded={open}");
  });

  it("shows a compact status overview and quiet published and draft states", () => {
    expect(source).toContain('className="panel embed-overview"');
    expect(source).toContain("embeds live");
    expect(source).toContain('embed-publish-state');
    expect(source).toContain('embed-draft-state');
    expect(source).not.toContain('className="embed-saved-status"');
    expect(css).toContain(".embed-overview{display:grid");
  });

  it("previews the saved embed in context and does not copy ignored style query parameters", () => {
    expect(source).toContain('title={`${meta.label} saved preview`}');
    expect(source).toContain('src={`/embed/${eventSlug}/${meta.route}`}');
    expect(source).toContain("Save your changes to refresh this preview.");
    expect(source).not.toContain("function toQuery");
    expect(source).not.toContain('data-params=');
  });

  it("protects aggregate settings drafts without guarding harmless card collapse", () => {
    expect(source).toContain("const hasUnsavedSettings = hasUnsavedEmbedSettings(configs, styleDrafts, filterDrafts)");
    expect(source).toContain("useUnsavedWorkGuard(hasUnsavedSettings)");
    expect(source).toContain("setOpenConfigId(open ? null : config.id)");
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
