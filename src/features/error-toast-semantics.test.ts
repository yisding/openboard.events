import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

function parse(path: string): ts.SourceFile {
  const text = readFileSync(new URL(path, import.meta.url), "utf8");
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function toastCalls(node: ts.Node, source: ts.SourceFile): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  function visit(candidate: ts.Node) {
    if (ts.isCallExpression(candidate) && candidate.expression.getText(source) === "toast") calls.push(candidate);
    ts.forEachChild(candidate, visit);
  }
  visit(node);
  return calls;
}

function isResponseFailureCondition(node: ts.Node): boolean {
  if (
    ts.isPrefixUnaryExpression(node)
    && node.operator === ts.SyntaxKind.ExclamationToken
    && ts.isPropertyAccessExpression(node.operand)
    && node.operand.name.text === "ok"
  ) return true;
  if (ts.isBinaryExpression(node)) {
    const property = ts.isPropertyAccessExpression(node.left) ? node.left.name.text : null;
    if (property === "status" && ts.isNumericLiteral(node.right) && Number(node.right.text) >= 400) return true;
    if (property === "code" && ts.isStringLiteral(node.right) && node.right.text === "STALE_WRITE") return true;
  }
  let found = false;
  ts.forEachChild(node, (child) => { if (isResponseFailureCondition(child)) found = true; });
  return found;
}

function failureToasts(source: ts.SourceFile): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  function visit(node: ts.Node) {
    if (ts.isCatchClause(node)) {
      calls.push(...toastCalls(node.block, source));
      return;
    }
    // `.catch(() => { … })` is the same recovery path as a catch clause written
    // out; without this the promise-chain form escapes the audit entirely.
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "catch") {
      for (const handler of node.arguments) calls.push(...toastCalls(handler, source));
    }
    if (ts.isIfStatement(node) && isResponseFailureCondition(node.expression)) {
      calls.push(...toastCalls(node.thenStatement, source));
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return calls;
}

function hasErrorKind(call: ts.CallExpression): boolean {
  const options = call.arguments[1];
  if (!options || !ts.isObjectLiteralExpression(options)) return false;
  return options.properties.some((property) => (
    ts.isPropertyAssignment(property)
    && ((ts.isIdentifier(property.name) && property.name.text === "kind") || (ts.isStringLiteral(property.name) && property.name.text === "kind"))
    && ts.isStringLiteral(property.initializer)
    && property.initializer.text === "error"
  ));
}

describe("audited mutation failure toasts", () => {
  it("uses assertive error semantics for every named failure path", () => {
    for (const [path, expectedFailures] of [
      ["./auth/components/sessions-panel.tsx", 8],
      ["./dashboard/components/ApiKeysPanel.tsx", 7],
      ["./forms/components/builder/routing-rules-panel.tsx", 4],
      ["./organizations/components/team-panel.tsx", 12],
      ["./portal/resources/components/resource-page-editor.tsx", 3],
      ["./billing/components/billing-panel.tsx", 1],
      ["./events/components/branding-panel.tsx", 1],
      ["./portal/components/home/add-to-calendar-button.tsx", 1],
      ["./portal/components/speakers-admin/speaker-detail-view.tsx", 5],
      ["./portal/components/speakers-admin/speaker-roster-panels.tsx", 5],
      ["./portal/tasks-admin/components/task-matrix-drawer.tsx", 1],
    ] as const) {
      const source = parse(path);
      const calls = failureToasts(source);
      expect(calls, path).toHaveLength(expectedFailures);
      expect(calls.every(hasErrorKind), path).toBe(true);
    }
  });
});
