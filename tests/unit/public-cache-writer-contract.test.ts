import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const EVENT_DATA_WRITERS = [
  "../../src/app/api/internal/agenda/sessions/route.ts",
  "../../src/app/api/internal/agenda/sessions/[sessionId]/route.ts",
  "../../src/app/api/internal/agenda/sessions/[sessionId]/move/route.ts",
  "../../src/app/api/internal/agenda/sessions/[sessionId]/revisions/route.ts",
  "../../src/app/api/internal/agenda/sessions/bulk-publish/route.ts",
  "../../src/app/api/internal/agenda/placements/apply/route.ts",
  "../../src/app/api/internal/events/[eventId]/vocab/[kind]/[id]/route.ts",
  "../../src/app/api/internal/forms/[formId]/submit/route.ts",
  "../../src/app/api/internal/portal/profile/route.ts",
  "../../src/app/api/internal/portal/tasks/[taskId]/complete/route.ts",
  "../../src/app/api/internal/speakers/[eventId]/import/route.ts",
  "../../src/app/api/internal/speakers/[eventId]/[contactId]/route.ts",
  "../../src/app/api/internal/speakers/[eventId]/[contactId]/roster/route.ts",
] as const;

function importedCalls(path: string, exportedName: string): ts.CallExpression[] {
  const text = readFileSync(new URL(path, import.meta.url), "utf8");
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let localName: string | null = null;

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
    if (statement.moduleSpecifier.text !== "@/features/public/server/revalidate") continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if ((element.propertyName?.text ?? element.name.text) === exportedName) localName = element.name.text;
    }
  }
  if (!localName) return [];

  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === localName) calls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return calls;
}

function literalArguments(call: ts.CallExpression): string[] {
  const values: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node)) values.push(node.text);
    ts.forEachChild(node, visit);
  };
  for (const argument of call.arguments) visit(argument);
  return values;
}

describe("public-cache mutation ownership", () => {
  it.each(EVENT_DATA_WRITERS)("%s emits schedule and speaker invalidations", (route) => {
    const calls = importedCalls(route, "revalidatePublicEvent");
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(literalArguments(call)).toEqual(expect.arrayContaining(["schedule", "speakers"]));
    }
  });

  it("event detail writes emit the shared metadata invalidation", () => {
    expect(importedCalls(
      "../../src/app/api/internal/events/[eventId]/route.ts",
      "revalidatePublicEventMetadata",
    )).toHaveLength(1);
  });

  it("embed settings emit a content-type invalidation", () => {
    expect(importedCalls(
      "../../src/app/api/internal/embeds/[eventId]/[embedId]/route.ts",
      "revalidatePublicEmbed",
    )).toHaveLength(1);
  });
});
