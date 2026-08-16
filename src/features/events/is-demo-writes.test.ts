import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { eventDetailsPatchSchema } from "./schemas";

/**
 * First Fair (design §5.4) — the written invariant: a demo event is never
 * flippable to `is_demo = false`, because clearing that flag is exactly the
 * mechanism by which eighteen fabricated speakers would start receiving real
 * mail. `events.isDemo` is applied exactly once, inside `createEventIn`'s own
 * INSERT (`src/features/events/server/mutations.ts`), as a non-schema options
 * argument with no HTTP surface — and nowhere else. This AST test is the
 * enforcement, not the convention: a future writer that adds a second
 * `isDemo` write target (an UPDATE that clears it, a batch-insert helper, a
 * script) fails `pnpm check` at this file rather than shipping quietly.
 */

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const SOURCE_ROOT = resolve(REPO_ROOT, "src");
const WRITE_METHODS = new Set(["values", "set"]);

function repoPath(path: string): string {
  return relative(REPO_ROOT, path).split(sep).join("/");
}

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(path));
      continue;
    }
    if (!/\.(?:ts|tsx)$/u.test(entry.name)) continue;
    if (/\.(?:test|spec)\.[jt]sx?$/u.test(entry.name)) continue;
    files.push(path);
  }
  return files;
}

/** Every object literal an expression can statically resolve to — through a
 * parenthesized wrapper, a ternary's two branches, or an array of rows. A
 * plain identifier (`...someObject`) resolves to nothing: this test cannot
 * prove a dynamic spread is innocent, so — like `check-source-invariants.ts`'s
 * own literal-value walker — it only ever flags what it can see. */
function objectLiteralsIn(node: ts.Expression): ts.ObjectLiteralExpression[] {
  if (ts.isObjectLiteralExpression(node)) return [node];
  if (ts.isParenthesizedExpression(node)) return objectLiteralsIn(node.expression);
  if (ts.isConditionalExpression(node)) return [...objectLiteralsIn(node.whenTrue), ...objectLiteralsIn(node.whenFalse)];
  if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap((element) => ts.isSpreadElement(element) ? [] : objectLiteralsIn(element));
  return [];
}

function hasIsDemoKey(object: ts.ObjectLiteralExpression): boolean {
  return object.properties.some((property) => {
    if ((ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) && property.name.getText() === "isDemo") {
      return true;
    }
    if (ts.isSpreadAssignment(property)) return objectLiteralsIn(property.expression).some(hasIsDemoKey);
    return false;
  });
}

/** Every `*.values(...)` / `*.set(...)` call whose argument carries an
 * `isDemo` key, anywhere in the file — the drizzle insert/update write shape,
 * not a read (`eq(events.isDemo, …)`) and not an options object merely passed
 * to another function (`createEventIn(…, { isDemo: true })` is a caller
 * supplying an argument, not a write target in its own right). */
function writesIsDemo(path: string): boolean {
  const text = readFileSync(path, "utf8");
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  let found = false;
  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && WRITE_METHODS.has(node.expression.name.text)
      && node.arguments.some((argument) => objectLiteralsIn(argument).some(hasIsDemoKey))
    ) {
      found = true;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return found;
}

describe("events.isDemo is a one-way flag", () => {
  it("is written as a drizzle insert/update target in exactly one module", () => {
    const modulesThatWriteIt = sourceFiles(SOURCE_ROOT)
      .filter(writesIsDemo)
      .map(repoPath)
      .sort();

    expect(modulesThatWriteIt).toEqual(["src/features/events/server/mutations.ts"]);
  });

  it("has no isDemo key on the event details patch schema", () => {
    expect(Object.keys(eventDetailsPatchSchema.shape)).not.toContain("isDemo");
  });

  it("strips isDemo out of a details patch that tries to supply it, even outside HTTP", () => {
    const parsed = eventDetailsPatchSchema.parse({ name: "Renamed", isDemo: true });
    expect(parsed).not.toHaveProperty("isDemo");
  });
});
