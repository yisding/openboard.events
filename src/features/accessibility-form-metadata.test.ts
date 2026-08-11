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

describe("audited form metadata", () => {
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
      ["./forms/forms-page.tsx", 1],
      ["./forms/form-builder.tsx", 6],
      ["./events/components/details-tab.tsx", 5],
      ["./portal/form-builder/components/portal-forms-page.tsx", 1],
      ["./portal/form-builder/components/portal-form-builder.tsx", 4],
      ["./portal/resources/components/resource-page-editor.tsx", 1],
      ["./portal/tasks-admin/components/file-requests-view.tsx", 1],
      ["./portal/tasks-admin/components/task-editor.tsx", 3],
      ["./submissions/evaluation/components/plan-editor.tsx", 1],
      ["./submissions/evaluation/components/reviewer-invite-dialog.tsx", 2],
    ] as const;

    for (const [path, minimum] of expectations) {
      const file = parse(path);
      const controls = ["input", "select", "textarea", "DateTimePicker"].flatMap((tag) => elements(file, tag));
      expect(controls.filter((node) => hasAttribute(file, node, "required")).length, path).toBeGreaterThanOrEqual(minimum);
    }
  });
});
