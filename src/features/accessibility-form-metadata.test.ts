import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

type Opening = ts.JsxOpeningElement | ts.JsxSelfClosingElement;

function parse(path: string): ts.SourceFile {
  const text = readFileSync(new URL(path, import.meta.url), "utf8");
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function elements(source: ts.SourceFile, tag: string): Opening[] {
  const found: Opening[] = [];
  function visit(node: ts.Node) {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === tag) found.push(node);
    ts.forEachChild(node, visit);
  }
  visit(source);
  return found;
}

function hasAttribute(source: ts.SourceFile, node: Opening, name: string): boolean {
  return node.attributes.properties.some((property) => ts.isJsxAttribute(property) && property.name.getText(source) === name);
}

function attributeText(source: ts.SourceFile, node: Opening, name: string): string | undefined {
  const property = node.attributes.properties.find((candidate): candidate is ts.JsxAttribute => (
    ts.isJsxAttribute(candidate) && candidate.name.getText(source) === name
  ));
  return property?.initializer?.getText(source);
}

describe("audited form metadata", () => {
  it("names every shared segmented selector and progress indicator at its call site", () => {
    const segmentedPaths = [
      "./forms/components/builder/visibility-rule-editor.tsx",
      "./portal/tasks-admin/components/tasks-admin-view.tsx",
      "./public/embeds-admin-page.tsx",
    ];
    const progressPaths = [
      "./billing/components/billing-panel.tsx",
      "./portal/portal-home.tsx",
      "./portal/portal-profile.tsx",
      "./portal/portal-tasks.tsx",
      "./portal/task-runtime/components/task-list.tsx",
      "./portal/tasks-admin/components/tasks-admin-view.tsx",
      "./submissions/evaluation/components/plans-view.tsx",
      "./submissions/evaluation/components/review-queue-view.tsx",
    ];

    for (const path of segmentedPaths) {
      const file = parse(path);
      const controls = elements(file, "Segmented");
      expect(controls.length, path).toBeGreaterThan(0);
      expect(controls.every((node) => hasAttribute(file, node, "label")), path).toBe(true);
    }
    for (const path of progressPaths) {
      const file = parse(path);
      const controls = elements(file, "ProgressBar");
      expect(controls.length, path).toBeGreaterThan(0);
      expect(controls.every((node) => hasAttribute(file, node, "label")), path).toBe(true);
    }
  });

  it("gives every audited rich-text editor a contextual accessible name", () => {
    for (const path of [
      "./forms/form-builder.tsx",
      "./forms/components/builder/notifications-step.tsx",
      "./forms/components/builder/success-page-card.tsx",
      "./portal/resources/components/resource-page-editor.tsx",
      "./portal/tasks-admin/components/file-requests-view.tsx",
      "./portal/tasks-admin/components/task-editor.tsx",
      "./portal/components/speakers-admin/speaker-detail-view.tsx",
    ]) {
      const file = parse(path);
      const editors = elements(file, "RichTextEditor");
      expect(editors.length, path).toBeGreaterThan(0);
      expect(editors.every((node) => hasAttribute(file, node, "ariaLabel") || hasAttribute(file, node, "ariaLabelledBy")), path).toBe(true);
    }
  });

  it("puts required state on the audited controls, not only their visual Field marker", () => {
    const expectations = [
      { path: "./forms/forms-page.tsx", controls: [["input", "name"]] },
      { path: "./forms/form-builder.tsx", controls: [
        ["input", "newLabel"], ["input", "form.internalName", 2], ["input", "form.externalTitle"],
        ["input", "form.pageHeading"], ["input", "section.title"], ["input", "section.pageHeading"],
      ] },
      { path: "./events/components/details-tab.tsx", controls: [
        ["input", "name"], ["input", "slug"], ["Select", "timezone"],
        ["DateTimePicker", "startsAt"], ["DateTimePicker", "endsAt"],
      ] },
      { path: "./portal/form-builder/components/portal-forms-page.tsx", controls: [["input", "name"]] },
      { path: "./portal/form-builder/components/portal-form-builder.tsx", controls: [
        ["input", "internalName"], ["input", "externalTitle"], ["input", "customLabel"], ["input", "label"],
      ] },
      { path: "./portal/resources/components/resource-page-editor.tsx", controls: [["input", "draft.title"]] },
      { path: "./portal/tasks-admin/components/file-requests-view.tsx", controls: [["input", "draft.title"]] },
      { path: "./portal/tasks-admin/components/task-editor.tsx", controls: [
        ["input", "draft.name"], ["Select", "draft.formId"], ["Select", "draft.fileRequestId"],
      ] },
      { path: "./submissions/evaluation/components/plan-editor.tsx", controls: [["input", "draft.name"]] },
      { path: "./submissions/evaluation/components/reviewer-invite-dialog.tsx", controls: [["input", "email"], ["input", "password"]] },
    ] satisfies Array<{ path: string; controls: Array<[tag: string, valueExpression: string, count?: number]> }>;

    for (const { path, controls } of expectations) {
      const file = parse(path);
      for (const [tag, valueExpression, expectedCount = 1] of controls) {
        const matched = elements(file, tag).filter((node) => attributeText(file, node, "value")?.includes(valueExpression));
        expect(matched, `${path}: ${tag} value={${valueExpression}}`).toHaveLength(expectedCount);
        expect(matched.every((node) => hasAttribute(file, node, "required")), `${path}: ${tag} value={${valueExpression}}`).toBe(true);
      }
    }
  });

  it("lets the shared modal and drawer own initial focus for audited dialog controls", () => {
    const expectations = [
      ["./portal/form-builder/components/portal-forms-page.tsx", "input", "name"],
      ["./portal/resources/components/resource-page-editor.tsx", "input", "draft.title"],
      ["./portal/tasks-admin/components/file-requests-view.tsx", "input", "draft.title"],
      ["./portal/tasks-admin/components/task-editor.tsx", "input", "draft.name"],
      ["./submissions/evaluation/components/plan-editor.tsx", "input", "draft.name"],
      ["./submissions/evaluation/components/reviewer-invite-dialog.tsx", "input", "email"],
    ] as const;

    for (const [path, tag, valueExpression] of expectations) {
      const file = parse(path);
      const [control] = elements(file, tag).filter((node) => attributeText(file, node, "value")?.includes(valueExpression));
      expect(control, `${path}: ${tag} value={${valueExpression}}`).toBeDefined();
      expect(control && hasAttribute(file, control, "autoFocus"), path).toBe(false);
    }
  });
});
