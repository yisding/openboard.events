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
    expect(css).toContain(".reviewer-pending-invitations li{display:flex;align-items:center;justify-content:space-between;gap:12px");
  });

  it("keeps repeated action clusters visibly separated", () => {
    const plans = read("./submissions/evaluation/components/plans-view.tsx");
    const assignment = read("./submissions/evaluation/components/assignment-drawer.tsx");
    const queue = read("./submissions/evaluation/components/review-queue-view.tsx");
    const fileRequests = read("./portal/tasks-admin/components/file-requests-view.tsx");
    const resources = read("./portal/resources/components/resource-pages-admin-view.tsx");

    expect(plans).toContain('actions={\n          <>');
    expect(plans).not.toContain('actions={\n          <span className="row-actions">');
    expect(css).toContain(".row-actions { display: inline-flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; }");
    expect(css).toContain("@media(max-width:480px){.admin-task-row>.row-actions{grid-column:2;justify-content:flex-start}}");
    for (const source of [plans, assignment, queue, fileRequests, resources]) {
      expect(source).toContain('className="row-actions"');
    }
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
    expect(css).toContain(".message-preview .template-preview-heading{min-height:48px;padding:0 18px;display:flex");
    expect(css).toContain(".message-preview .template-preview-subject{padding:16px 18px 17px");
    expect(css).toContain(".message-preview .template-preview-body{padding:20px 18px}");
    expect(css).not.toContain("\n.template-editor__preview{display:block;padding:0");
  });

  it("overrides the gallery badge selector for centered speaker placeholders", () => {
    expect(css).toContain(".speaker-portrait>.person-avatar{position:static;");
    expect(css).toContain(".person-avatar-placeholder {");
  });

  it("keeps the landing-page sign-in action visible on compact layouts", () => {
    expect(css).toContain("@media (max-width: 385px) {");
    expect(css).toContain(".landing-links > a:not(.button) { display: none; }");
    expect(css).toContain(".landing-links { gap: 8px; }");
    expect(css).toContain(".landing-links .button-primary svg { display: none; }");
    expect(css).toContain(
      ".landing-nav > .brand > span:not(.brand-mark) { display: none; }",
    );
    expect(css).toContain(
      ".hero .eyebrow { width: fit-content; max-width: 100%; line-height: 1.35; justify-content: center; }",
    );
    expect(css).not.toContain(
      ".landing-links > a:not(.button), .landing-links .button-secondary { display: none; }",
    );
  });

  it("gives discrete public session and gallery actions full pointer targets", () => {
    expect(css).toContain(
      ".public-session-main h3 button{width:100%;min-height:32px;",
    );
    expect(css).toContain(
      ".session-card-toggle,.speaker-gallery footer button,.speaker-gallery footer a{min-height:32px}",
    );
    expect(css).toContain(
      ".public-session-main h3 button,.session-card-toggle,.speaker-gallery footer button,.speaker-gallery footer a{min-height:44px}",
    );
  });
});
