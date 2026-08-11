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

function attribute(source: ts.SourceFile, node: Opening, name: string): ts.JsxAttribute | undefined {
  return node.attributes.properties.find((property): property is ts.JsxAttribute => ts.isJsxAttribute(property) && property.name.getText(source) === name);
}

describe("feature switch semantics", () => {
  it("parses every audited toggle as a named, checked shared Switch", () => {
    const audited = [
      ["./forms-page.tsx", 1],
      ["./components/builder/settings-step.tsx", 1],
      ["./components/builder/success-page-card.tsx", 1],
      ["./components/builder/routing-rules-panel.tsx", 2],
      ["../portal/tasks-admin/components/task-editor.tsx", 1],
      ["../public/embeds-admin-page.tsx", 5],
    ] as const;

    for (const [path, expectedCount] of audited) {
      const source = parse(path);
      const switches = elements(source, "Switch");
      expect(switches, path).toHaveLength(expectedCount);
      for (const toggle of switches) {
        expect(attribute(source, toggle, "label"), `${path} switch label`).toBeDefined();
        expect(attribute(source, toggle, "checked"), `${path} switch state`).toBeDefined();
      }
      const rawSwitchButtons = elements(source, "button").filter((node) => attribute(source, node, "className")?.getText(source).includes("switch"));
      expect(rawSwitchButtons, `${path} raw switch buttons`).toHaveLength(0);
    }
  });

  it("parses content-specific names for every repeated embed switch", () => {
    const source = parse("../public/embeds-admin-page.tsx");
    const labels = elements(source, "Switch").map((node) => attribute(source, node, "label")?.initializer?.getText(source) ?? "");
    expect(labels).toHaveLength(5);
    expect(labels.every((label) => label.includes("meta.label"))).toBe(true);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
