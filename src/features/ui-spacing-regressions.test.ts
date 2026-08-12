import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("shared UI spacing regressions", () => {
  const css = read("../app/globals.css");

  it("top-aligns paired fields so one field's error cannot move its neighbor", () => {
    expect(css).toMatch(/\.form-grid\s*\{[^}]*align-items:\s*start/gu);
    expect(css).toMatch(/\.field\s*\{[^}]*align-content:\s*start/gu);
    expect(css).toMatch(/\.datetime-picker\{[^}]*height:40px/gu);
  });

  it("gives evaluation drawers the shared body inset and a compact invite variant", () => {
    const invite = read("./submissions/evaluation/components/reviewer-invite-dialog.tsx");
    const plan = read("./submissions/evaluation/components/plan-editor.tsx");
    const assignment = read("./submissions/evaluation/components/assignment-drawer.tsx");

    expect(invite).toContain("<Drawer open compact");
    expect(invite).toContain('className="drawer-body drawer-form"');
    expect(plan).toContain('className="form-stack drawer-body"');
    expect(plan).toContain('className="evaluation-field-row evaluation-number-row"');
    expect(plan).toContain('className="evaluation-field-row evaluation-window-row"');
    expect(plan).toContain('className="evaluation-field-row evaluation-criterion-row"');
    expect(assignment).toContain('className="form-stack drawer-body"');
    expect(css).toContain(".drawer-body { padding: 24px; }");
    expect(css).toContain(".drawer-compact { width: min(480px, 95vw); }");
    expect(css).toContain(".evaluation-number-row{grid-template-columns:repeat(3,minmax(0,1fr))}");
  });

  it("separates communications preview metadata from the rendered message", () => {
    const templates = read("./comms/components/templates-tab.tsx");
    const bulk = read("./comms/components/bulk-send-tab.tsx");
    const preview = read("./comms/components/message-preview.tsx");

    for (const source of [templates, bulk]) {
      expect(source).toContain("<MessagePreview");
    }
    expect(preview).toContain('className="template-preview-heading"');
    expect(preview).toContain('className="template-preview-subject"');
    expect(preview).toContain('className="template-preview-body"');
    expect(preview).toContain('className="template-editor__preview message-preview"');
    expect(css).toContain(".message-preview .template-preview-heading{min-height:44px;padding:0 16px;display:flex");
    expect(css).toContain(".message-preview .template-preview-subject{padding:12px 16px");
    expect(css).not.toContain("\n.template-editor__preview{display:block;padding:0");
  });

  it("overrides the gallery badge selector for centered speaker placeholders", () => {
    expect(css).toContain(".speaker-portrait>.person-avatar{position:static;");
    expect(css).toContain(".person-avatar-placeholder {");
  });
});
