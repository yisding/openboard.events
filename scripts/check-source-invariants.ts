import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import ts from "typescript";

const REPO_ROOT = resolve(process.env.SOURCE_INVARIANT_ROOT ?? process.cwd());
const SOURCE_ROOT = resolve(REPO_ROOT, "src");

type Violation = {
  line: number;
  message: string;
  path: string;
  rule: string;
};

function repoPath(path: string): string {
  return relative(REPO_ROOT, path).split(sep).join("/");
}

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(path));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      files.push(path);
    }
  }
  return files.sort();
}

function propertyName(node: ts.PropertyName): string | null {
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) return node.text;
  return null;
}

function objectPropertyValues(
  attributeName: string,
  object: ts.ObjectLiteralExpression,
): string[] {
  const values: string[] = [];
  for (const property of object.properties) {
    if (ts.isPropertyAssignment(property) && propertyName(property.name) === attributeName) {
      values.push(...literalValues(property.initializer));
    } else if (ts.isSpreadAssignment(property) && ts.isObjectLiteralExpression(property.expression)) {
      values.push(...objectPropertyValues(attributeName, property.expression));
    }
  }
  return values;
}

function objectHasProperty(attributeName: string, object: ts.ObjectLiteralExpression): boolean {
  return object.properties.some((property) => {
    if (
      (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property))
      && propertyName(property.name) === attributeName
    ) {
      return true;
    }
    return ts.isSpreadAssignment(property)
      && ts.isObjectLiteralExpression(property.expression)
      && objectHasProperty(attributeName, property.expression);
  });
}

/** Every string an expression can statically evaluate to. */
function literalValues(node: ts.Node | undefined): string[] {
  if (!node) return [];
  if (ts.isStringLiteralLike(node)) return [node.text];
  if (ts.isJsxExpression(node)) return literalValues(node.expression);
  if (ts.isParenthesizedExpression(node)) return literalValues(node.expression);
  if (ts.isConditionalExpression(node)) {
    return [...literalValues(node.whenTrue), ...literalValues(node.whenFalse)];
  }
  if (ts.isBinaryExpression(node)) {
    return [...literalValues(node.left), ...literalValues(node.right)];
  }
  if (
    ts.isAsExpression(node)
    || ts.isSatisfiesExpression(node)
    || ts.isTypeAssertionExpression(node)
    || ts.isNonNullExpression(node)
  ) {
    return literalValues(node.expression);
  }
  return [];
}

function jsxAttributeValues(
  attributeName: string,
  element: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
): string[] {
  const values: string[] = [];
  for (const attribute of element.attributes.properties) {
    if (ts.isJsxAttribute(attribute)) {
      if (attribute.name.getText() === attributeName) {
        values.push(...literalValues(attribute.initializer));
      }
      continue;
    }
    if (!ts.isObjectLiteralExpression(attribute.expression)) continue;
    values.push(...objectPropertyValues(attributeName, attribute.expression));
  }
  return values;
}

function hasJsxAttribute(
  attributeName: string,
  element: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
): boolean {
  return element.attributes.properties.some((attribute) => {
    if (ts.isJsxAttribute(attribute)) return attribute.name.getText() === attributeName;
    return ts.isObjectLiteralExpression(attribute.expression)
      && objectHasProperty(attributeName, attribute.expression);
  });
}

function moduleSpecifier(node: ts.Node): string | null {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    return node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)
      ? node.moduleSpecifier.text
      : null;
  }
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
    const expression = node.moduleReference.expression;
    return expression && ts.isStringLiteralLike(expression) ? expression.text : null;
  }
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
    return ts.isStringLiteralLike(node.argument.literal) ? node.argument.literal.text : null;
  }
  if (!ts.isCallExpression(node) || node.arguments.length === 0) return null;
  const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
  const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
  if (!isDynamicImport && !isRequire) return null;
  const firstArgument = node.arguments[0];
  return firstArgument && ts.isStringLiteralLike(firstArgument) ? firstArgument.text : null;
}

function accessName(node: ts.Node): string | null {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    return node.argumentExpression.text;
  }
  return null;
}

function isProcessReference(node: ts.Expression): boolean {
  if (ts.isIdentifier(node)) return node.text === "process";
  if (
    ts.isParenthesizedExpression(node)
    || ts.isAsExpression(node)
    || ts.isSatisfiesExpression(node)
    || ts.isTypeAssertionExpression(node)
    || ts.isNonNullExpression(node)
  ) {
    return isProcessReference(node.expression);
  }
  return (
    (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
    && accessName(node) === "process"
    && ts.isIdentifier(node.expression)
    && (node.expression.text === "globalThis" || node.expression.text === "global")
  );
}

function numericValue(node: ts.Expression): number | null {
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (
    ts.isPrefixUnaryExpression(node)
    && (node.operator === ts.SyntaxKind.MinusToken || node.operator === ts.SyntaxKind.PlusToken)
  ) {
    const value = numericValue(node.operand);
    if (value === null) return null;
    return node.operator === ts.SyntaxKind.MinusToken ? -value : value;
  }
  if (
    ts.isParenthesizedExpression(node)
    || ts.isAsExpression(node)
    || ts.isSatisfiesExpression(node)
    || ts.isTypeAssertionExpression(node)
  ) {
    return numericValue(node.expression);
  }
  return null;
}

function reviewerRouteAllowed(path: string): boolean {
  return /^src\/app\/api\/internal\/submissions\/[^/]+\/[^/]+\/route\.ts$/u.test(path)
    || /^src\/app\/api\/internal\/evaluation\/[^/]+\/(?:queue|reviews)\/route\.ts$/u.test(path)
    || /^src\/app\/api\/internal\/evaluation\/[^/]+\/plans\/[^/]+\/recusals\/route\.ts$/u.test(path)
    || path === "src/app/api/uploads/_lib.ts"
    || path === "src/features/auth/server/guards.test.ts";
}

function inspectFile(absolutePath: string): Violation[] {
  const path = repoPath(absolutePath);
  const source = ts.createSourceFile(
    path,
    readFileSync(absolutePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const violations: Violation[] = [];

  function report(node: ts.Node, rule: string, message: string): void {
    violations.push({
      line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      message,
      path,
      rule,
    });
  }

  function visit(node: ts.Node): void {
    const specifier = moduleSpecifier(node);
    if (specifier) {
      if (
        (specifier === "date-fns" || specifier.startsWith("date-fns/"))
        && path !== "src/shared/lib/time.ts"
      ) {
        report(node, "time-import", "date-fns imports belong in src/shared/lib/time.ts");
      }
      if (
        (specifier === "date-fns-tz" || specifier.startsWith("date-fns-tz/"))
        && path !== "src/shared/lib/time.ts"
      ) {
        report(node, "time-import", "date-fns-tz imports belong in src/shared/lib/time.ts");
      }
      if (
        (specifier === "resend" || specifier.startsWith("resend/"))
        && !path.startsWith("src/features/comms/server/")
      ) {
        report(node, "resend-import", "Resend imports belong in the communications server feature");
      }
      if (specifier === "aws4fetch" && path !== "src/shared/server/r2.ts") {
        report(node, "r2-import", "aws4fetch imports belong in src/shared/server/r2.ts");
      }
    }

    if (
      (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
      && accessName(node) === "env"
      && isProcessReference(node.expression)
      && path !== "src/shared/lib/env.ts"
      && path !== "src/app/page.tsx"
    ) {
      report(node, "process-env", "read environment variables through src/shared/lib/env.ts");
    }

    if (
      ts.isVariableDeclaration(node)
      && ts.isObjectBindingPattern(node.name)
      && node.initializer
      && isProcessReference(node.initializer)
      && path !== "src/shared/lib/env.ts"
      && path !== "src/app/page.tsx"
    ) {
      for (const element of node.name.elements) {
        const name = element.propertyName
          ? propertyName(element.propertyName)
          : ts.isIdentifier(element.name) ? element.name.text : null;
        if (name === "env") {
          report(element, "process-env", "read environment variables through src/shared/lib/env.ts");
        }
      }
    }

    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === "runtime"
      && literalValues(node.initializer).includes("edge")
    ) {
      report(node, "edge-runtime", "the application does not support the Next.js edge runtime");
    }

    if (
      ts.isIdentifier(node)
      && node.text === "FILES"
      && path !== "src/shared/server/r2.ts"
    ) {
      report(node, "r2-binding", "the FILES binding belongs in src/shared/server/r2.ts");
    }

    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "adminAuth") {
      const options = node.arguments[0];
      if (options && ts.isObjectLiteralExpression(options)) {
        const reviewer = objectPropertyValues("role", options).includes("reviewer");
        if (reviewer && !reviewerRouteAllowed(path)) {
          report(node, "reviewer-route", "reviewer-reachable admin routes require an explicit allowlist entry");
        }
      }
    }

    if (ts.isPropertyAssignment(node) && propertyName(node.name) === "fontSize") {
      const value = numericValue(node.initializer);
      if (value !== null && value < 12) {
        report(node, "inline-type-floor", "inline fontSize values must be at least 12");
      }
    }

    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (node.tagName.getText(source) === "select" && path !== "src/shared/ui/ui-kit.tsx") {
        report(node, "raw-select", "use the shared Select component instead of a raw select");
      }
      if (
        jsxAttributeValues("role", node).includes("switch")
        && path !== "src/shared/ui/ui-kit.tsx"
        && !/\.(?:test|spec)\.tsx$/u.test(path)
      ) {
        report(node, "raw-switch", "use the shared Switch component for role=switch");
      }
      const inputTypes = jsxAttributeValues("type", node);
      if (inputTypes.includes("date") || inputTypes.includes("datetime-local")) {
        report(node, "native-date", "use the shared date or date-time picker");
      }
      if (
        hasJsxAttribute("dangerouslySetInnerHTML", node)
        && path !== "src/shared/ui/app/rich-text-view.tsx"
      ) {
        report(node, "raw-html", "render sanitized HTML through RichTextView");
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(source);
  return violations;
}

const files = sourceFiles(SOURCE_ROOT);
const violations = files
  .flatMap(inspectFile)
  .sort((left, right) => (
    left.path.localeCompare(right.path)
    || left.line - right.line
    || left.rule.localeCompare(right.rule)
  ));

if (violations.length > 0) {
  console.error("AST source invariant violations:");
  for (const violation of violations) {
    console.error(`${violation.path}:${violation.line} [${violation.rule}] ${violation.message}`);
  }
  process.exit(1);
}

console.log(`AST source invariant check passed: ${files.length} source files.`);
