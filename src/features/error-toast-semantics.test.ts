import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

function parse(path: string): ts.SourceFile {
  const text = readFileSync(new URL(path, import.meta.url), "utf8");
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function failureToasts(source: ts.SourceFile): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node)
      && node.expression.getText(source) === "toast"
      && /failed|did not|could not|changed since/i.test(node.arguments[0]?.getText(source) ?? "")
    ) calls.push(node);
    ts.forEachChild(node, visit);
  }
  visit(source);
  return calls;
}

describe("audited mutation failure toasts", () => {
  it("uses assertive error semantics for every named failure path", () => {
    for (const path of [
      "./auth/components/sessions-panel.tsx",
      "./dashboard/components/ApiKeysPanel.tsx",
      "./forms/components/builder/routing-rules-panel.tsx",
      "./organizations/components/team-panel.tsx",
      "./portal/resources/components/resource-page-editor.tsx",
    ]) {
      const source = parse(path);
      const calls = failureToasts(source);
      expect(calls.length, path).toBeGreaterThan(0);
      expect(calls.every((call) => call.arguments[1]?.getText(source).includes('kind: "error"')), path).toBe(true);
    }
  });
});
