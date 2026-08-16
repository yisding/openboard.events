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

  it("holds every card to the page column instead of to the open editor's max-content", () => {
    // `.embed-cards` had no column track, so its single *implicit* `auto`
    // column sized to the widest card: an open editor measured ~1300px inside
    // a ~980px page and `.embed-card{overflow:clip}` cut the surplus off with
    // nothing to scroll — a third of the preview pane and the edge of Done.
    expect(css).toContain(".embed-cards{display:grid;grid-template-columns:minmax(0,1fr);gap:10px}");
    expect(css).not.toContain(".embed-cards{display:grid;gap:10px}");
    // Same reason one level down, in the collapsed single-column breakpoints:
    // a bare `1fr` is `minmax(auto,1fr)`, floored at the content's min-content.
    expect(css).toContain(".embed-editor-layout{grid-template-columns:minmax(0,1fr)}");
    expect(css).toContain(".embed-settings-grid{grid-template-columns:minmax(0,1fr)}");
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

  it("reddens the accent control when the hex is rejected, not just its message", () => {
    // Both accent inputs sit inside `.color-input`, so the child combinators in
    // this rule cannot reach them on their own.
    expect(source).toContain('error={accentValid ? undefined : "Use a hex color like #00a878"}');
    expect(source).toContain('<div className="color-input">');
    expect(css).toContain(".field-invalid .color-input input { border-color: var(--red); }");
  });

  it("recommends an accessible auto-resizing install while preserving the script-free fallback", () => {
    expect(source).toContain("Recommended: the loader resizes automatically");
    expect(source).toContain("Copy auto-resizing embed");
    expect(source).toContain("Copy fixed-height iframe");
    expect(source).toContain("autoResizeEmbedSnippet({ origin, eventSlug, route");
    expect(source).toContain("fixedHeightEmbedSnippet({ origin, eventSlug, route");
  });
});
