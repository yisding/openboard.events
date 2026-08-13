import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * DD-2 (#116) — the JSX-aware half of the one-date-idiom rule.
 *
 * `scripts/check-invariants.sh` greps for the literal attribute, which is the
 * fast gate and catches every spelling anyone actually writes. It cannot see
 * through a conditional or a spread, though, so this walks the syntax tree and
 * resolves every statically-knowable `type` value instead.
 *
 * The themed picker renders a read-only text trigger and an application-owned
 * calendar. The allowlist is therefore empty: a newly introduced native date
 * popup is always a regression, including in participant-authored forms.
 */
const SRC = fileURLToPath(new URL("../", import.meta.url));

const DATETIME_LOCAL_EXEMPT: string[] = [];
const DATE_EXEMPT: string[] = [];

function tsxFiles(): string[] {
  return readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .filter((entry) => entry.endsWith(".tsx"))
    .map((entry) => entry.split(path.sep).join("/"))
    .sort();
}

/** Every string this expression could evaluate to, where that is knowable. */
function literalValues(node: ts.Node): string[] {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isJsxExpression(node)) return node.expression ? literalValues(node.expression) : [];
  if (ts.isParenthesizedExpression(node)) return literalValues(node.expression);
  // `type={cond ? "date" : "text"}` — both arms count.
  if (ts.isConditionalExpression(node)) return [...literalValues(node.whenTrue), ...literalValues(node.whenFalse)];
  // `type={x ?? "date"}` / `type={x || "date"}`.
  if (ts.isBinaryExpression(node)) return [...literalValues(node.left), ...literalValues(node.right)];
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return literalValues(node.expression);
  return [];
}

/** The `type` values an element sets, through a named attribute or a spread of
 *  an inline object literal (`{...{ type: "date" }}`). */
function typeValues(source: ts.SourceFile, element: ts.JsxOpeningElement | ts.JsxSelfClosingElement): string[] {
  const found: string[] = [];
  for (const property of element.attributes.properties) {
    if (ts.isJsxAttribute(property)) {
      if (property.name.getText(source) !== "type" || !property.initializer) continue;
      found.push(...literalValues(property.initializer));
      continue;
    }
    if (ts.isJsxSpreadAttribute(property) && ts.isObjectLiteralExpression(property.expression)) {
      for (const member of property.expression.properties) {
        if (!ts.isPropertyAssignment(member)) continue;
        const key = ts.isIdentifier(member.name) || ts.isStringLiteral(member.name) ? member.name.text : null;
        if (key === "type") found.push(...literalValues(member.initializer));
      }
    }
  }
  return found;
}

function nativeDateControls(relativePath: string): string[] {
  const source = ts.createSourceFile(
    relativePath,
    readFileSync(path.join(SRC, relativePath), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      for (const value of typeValues(source, node)) {
        if (value === "date" || value === "datetime-local") found.push(value);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return found;
}

describe("native date controls", () => {
  const files = tsxFiles();

  it("finds .tsx files to walk at all", () => {
    // A broken glob would make every assertion below vacuously true.
    expect(files.length).toBeGreaterThan(50);
    expect(files).toContain("shared/ui/app/datetime-picker.tsx");
  });

  it("renders no native zone-less instant, however the type is written", () => {
    const offenders = files
      .filter((file) => !DATETIME_LOCAL_EXEMPT.includes(file))
      .filter((file) => nativeDateControls(file).includes("datetime-local"));
    expect(offenders).toEqual([]);
  });

  it("renders no native calendar date, including in participant forms", () => {
    const offenders = files
      .filter((file) => !DATE_EXEMPT.includes(file))
      .filter((file) => nativeDateControls(file).includes("date"));
    expect(offenders).toEqual([]);
  });

  it("resolves the forms a grep cannot see", () => {
    const probe = ts.createSourceFile("probe.tsx", `
      const a = <input type={flag ? "datetime-local" : "text"} />;
      const b = <input {...{ type: "date" }} />;
      const c = <input type={fallback ?? "datetime-local"} />;
      const d = <input type={\`date\`} />;
      const e = <input data-type="date" type="text" />;
      const f = <input type={computed} />;
    `, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

    const found: string[] = [];
    function visit(node: ts.Node) {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) found.push(...typeValues(probe, node));
      ts.forEachChild(node, visit);
    }
    visit(probe);

    // a, b, c, d are caught; `data-type` is not a `type`, and a computed value
    // resolves to nothing rather than to a false positive.
    expect(found.filter((value) => value === "date" || value === "datetime-local"))
      .toEqual(["datetime-local", "date", "datetime-local", "date"]);
    expect(found).toContain("text");
  });
});
