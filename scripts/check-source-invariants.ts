import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import ts from "typescript";

const REPO_ROOT = resolve(process.env.SOURCE_INVARIANT_ROOT ?? process.cwd());
const SOURCE_ROOT = resolve(REPO_ROOT, "src");
const FINAL_SUBMIT_FILES = new Set([
  "src/features/forms/server/submit.ts",
  "src/features/submissions/server/mutations.ts",
]);
const IDENTITY_RESOLUTION_FILE = "src/features/event-contacts/server/identity-links.ts";
const SQL_EMAIL_COLUMN_EQUALITY = /\b[a-z_][a-z0-9_]*\.email\b\s*\)*\s*=\s*(?:(?:lower|btrim)\s*\(\s*)*\b[a-z_][a-z0-9_]*\.email\b/iu;
const IDENTITY_TABLE_NAMES = new Set(["contacts", "organizationContacts", "users"]);

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

function taggedTemplateText(node: ts.TaggedTemplateExpression): string {
  if (ts.isNoSubstitutionTemplateLiteral(node.template)) return node.template.text;
  return node.template.head.text + node.template.templateSpans
    .map((span) => span.literal.text)
    .join("");
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

function unwrapExpression(node: ts.Expression): ts.Expression {
  if (
    ts.isParenthesizedExpression(node)
    || ts.isAsExpression(node)
    || ts.isSatisfiesExpression(node)
    || ts.isTypeAssertionExpression(node)
    || ts.isNonNullExpression(node)
  ) {
    return unwrapExpression(node.expression);
  }
  return node;
}

function identityTableReference(
  node: ts.Expression | undefined,
  tableAliases: ReadonlyMap<string, string>,
  schemaNamespaces: ReadonlySet<string>,
): string | null {
  if (!node) return null;
  const expression = unwrapExpression(node);
  if (ts.isIdentifier(expression)) return tableAliases.get(expression.text) ?? null;
  if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    const name = accessName(expression);
    if (name && IDENTITY_TABLE_NAMES.has(name) && ts.isIdentifier(expression.expression) && schemaNamespaces.has(expression.expression.text)) {
      return name;
    }
  }
  if (
    ts.isCallExpression(expression)
    && ts.isIdentifier(expression.expression)
    && (expression.expression.text === "alias" || expression.expression.text === "aliasedTable")
  ) {
    return identityTableReference(expression.arguments[0], tableAliases, schemaNamespaces);
  }
  return null;
}

function identityEmailTable(
  node: ts.Expression | undefined,
  tableAliases: ReadonlyMap<string, string>,
  schemaNamespaces: ReadonlySet<string>,
): string | null {
  if (!node) return null;
  const expression = unwrapExpression(node);
  if (
    (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression))
    && accessName(expression) === "email"
  ) {
    return identityTableReference(expression.expression, tableAliases, schemaNamespaces);
  }
  return null;
}

function identityTableSymbols(source: ts.SourceFile): {
  schemaNamespaces: Set<string>;
  tableAliases: Map<string, string>;
} {
  const schemaNamespaces = new Set<string>();
  const tableAliases = new Map<string, string>([...IDENTITY_TABLE_NAMES].map((name) => [name, name]));
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause?.namedBindings) continue;
    const specifier = moduleSpecifier(statement);
    if (!specifier?.startsWith("@/db/schema")) continue;
    if (ts.isNamespaceImport(statement.importClause.namedBindings)) {
      schemaNamespaces.add(statement.importClause.namedBindings.name.text);
      continue;
    }
    for (const element of statement.importClause.namedBindings.elements) {
      const imported = element.propertyName?.text ?? element.name.text;
      if (IDENTITY_TABLE_NAMES.has(imported)) tableAliases.set(element.name.text, imported);
    }
  }

  // Drizzle aliases are conventionally module-level declarations. Resolve to
  // a fixed point so `const reviewers = aliasedTable(accounts, ...)` retains
  // the canonical `users` identity even when `accounts` is itself an import or
  // assignment alias.
  let changed = true;
  while (changed) {
    changed = false;
    for (const statement of source.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          const canonical = identityTableReference(declaration.initializer, tableAliases, schemaNamespaces);
          if (canonical && tableAliases.get(declaration.name.text) !== canonical) {
            tableAliases.set(declaration.name.text, canonical);
            changed = true;
          }
          continue;
        }
        if (!ts.isObjectBindingPattern(declaration.name) || !declaration.initializer) continue;
        const initializer = unwrapExpression(declaration.initializer);
        if (!ts.isIdentifier(initializer) || !schemaNamespaces.has(initializer.text)) continue;
        for (const element of declaration.name.elements) {
          const imported = element.propertyName ? propertyName(element.propertyName) : ts.isIdentifier(element.name) ? element.name.text : null;
          if (!imported || !IDENTITY_TABLE_NAMES.has(imported) || !ts.isIdentifier(element.name)) continue;
          if (tableAliases.get(element.name.text) !== imported) {
            tableAliases.set(element.name.text, imported);
            changed = true;
          }
        }
      }
    }
  }
  return { schemaNamespaces, tableAliases };
}

function shorthandInitializer(node: ts.ShorthandPropertyAssignment): ts.Expression | undefined {
  let parent: ts.Node | undefined = node.parent;
  while (parent) {
    if (ts.isBlock(parent) || ts.isSourceFile(parent)) {
      for (const statement of [...parent.statements].reverse()) {
        if (statement.getStart() >= node.getStart() || !ts.isVariableStatement(statement)) continue;
        for (const declaration of [...statement.declarationList.declarations].reverse()) {
          if (ts.isIdentifier(declaration.name) && declaration.name.text === node.name.text) {
            return declaration.initializer;
          }
        }
      }
    }
    parent = parent.parent;
  }
  return undefined;
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
  const isTestFile = /\.(?:test|spec)\.[tj]sx?$/u.test(path);
  const source = ts.createSourceFile(
    path,
    readFileSync(absolutePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const { schemaNamespaces, tableAliases } = identityTableSymbols(source);
  const violations: Violation[] = [];
  let queryInvalidation: ts.CallExpression | null = null;
  let routeRefresh: ts.CallExpression | null = null;
  const routerNames = new Set<string>();

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
      if (
        specifier === "@tanstack/react-query"
        && ts.isImportDeclaration(node)
        && node.importClause?.namedBindings
        && ts.isNamedImports(node.importClause.namedBindings)
        && !isTestFile
      ) {
        for (const element of node.importClause.namedBindings.elements) {
          if (node.importClause.isTypeOnly || element.isTypeOnly) continue;
          const imported = element.propertyName?.text ?? element.name.text;
          if (imported === "QueryClient" && path !== "src/shared/lib/query-client.ts") {
            report(element, "query-client-owner", "create QueryClient instances only through src/shared/lib/query-client.ts");
          }
          if (imported === "QueryClientProvider" && path !== "src/shared/ui/app/query-boundary.tsx") {
            report(element, "query-client-owner", "provide query clients only through the shared QueryBoundary");
          }
        }
      }
    }

    if (
      !isTestFile
      && (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node))
      && propertyName(node.name) === "queryKey"
      && ts.isArrayLiteralExpression(unwrapExpression(
        ts.isPropertyAssignment(node)
          ? node.initializer
          : shorthandInitializer(node) ?? node.name,
      ))
    ) {
      report(node, "query-key-literal", "build query keys with the owning feature's key factory");
    }

    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.initializer
      && ts.isCallExpression(node.initializer)
      && ts.isIdentifier(node.initializer.expression)
      && node.initializer.expression.text === "useRouter"
    ) {
      routerNames.add(node.name.text);
    }

    if (ts.isCallExpression(node)) {
      if (
        !isTestFile
        && path !== IDENTITY_RESOLUTION_FILE
        && ts.isIdentifier(node.expression)
        && node.expression.text === "eq"
        && identityEmailTable(node.arguments[0], tableAliases, schemaNamespaces) !== null
        && identityEmailTable(node.arguments[1], tableAliases, schemaNamespaces) !== null
        && identityEmailTable(node.arguments[0], tableAliases, schemaNamespaces)
          !== identityEmailTable(node.arguments[1], tableAliases, schemaNamespaces)
      ) {
        report(node, "identity-email-join", "cross-identity email comparisons belong in the event-contact identity resolver");
      }

      if (
        !isTestFile
        && ts.isIdentifier(node.expression)
        && ["useInfiniteQuery", "useQuery", "useSuspenseQuery"].includes(node.expression.text)
      ) {
        const options = node.arguments[0];
        if (options && ts.isObjectLiteralExpression(options)) {
          for (const option of options.properties) {
            if (
              (ts.isPropertyAssignment(option) || ts.isShorthandPropertyAssignment(option))
              && propertyName(option.name) === "initialData"
            ) {
              report(option, "query-initial-data", "hydrate the feature key through QueryBoundary instead of useQuery initialData");
            }
          }
        }
      }

      if (ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression)) {
        const called = accessName(node.expression);
        if (called === "invalidateQueries") queryInvalidation ??= node;
        if (
          called === "refresh"
          && ts.isIdentifier(node.expression.expression)
          && routerNames.has(node.expression.expression.text)
        ) {
          routeRefresh ??= node;
        }
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
      FINAL_SUBMIT_FILES.has(path)
      && ts.isTaggedTemplateExpression(node)
      && ts.isIdentifier(node.tag)
      && node.tag.text === "sql"
    ) {
      const statement = taggedTemplateText(node).replace(/\s+/gu, " ").toUpperCase();
      if (/\b(?:FROM|UPDATE) EVENTS\b/u.test(statement) && statement.includes("FOR UPDATE")) {
        report(node, "submission-event-lock", "final submit must not lock the shared event row");
      }
    }


    if (
      !isTestFile
      && path !== IDENTITY_RESOLUTION_FILE
      && ts.isTaggedTemplateExpression(node)
      && ts.isIdentifier(node.tag)
      && node.tag.text === "sql"
      && SQL_EMAIL_COLUMN_EQUALITY.test(taggedTemplateText(node))
    ) {
      report(node, "identity-email-join", "cross-identity email comparisons belong in the event-contact identity resolver");
    }

    if (
      ts.isIdentifier(node)
      && node.text === "FILES"
      && path !== "src/shared/server/r2.ts"
    ) {
      report(node, "r2-binding", "the FILES binding belongs in src/shared/server/r2.ts");
    }
    if (
      ts.isStringLiteralLike(node)
      && node.text === "FILES"
      && ts.isElementAccessExpression(node.parent)
      && node.parent.argumentExpression === node
      && path !== "src/shared/server/r2.ts"
    ) {
      report(node.parent, "r2-binding", "the FILES binding belongs in src/shared/server/r2.ts");
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

    if (
      (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node))
      && propertyName(node.name) === "dangerouslySetInnerHTML"
      && path !== "src/shared/ui/app/rich-text-view.tsx"
    ) {
      report(node, "raw-html", "render sanitized HTML through RichTextView");
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
        node.attributes.properties.some((attribute) => (
          ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "dangerouslySetInnerHTML"
        ))
        && path !== "src/shared/ui/app/rich-text-view.tsx"
      ) {
        report(node, "raw-html", "render sanitized HTML through RichTextView");
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(source);
  if (!isTestFile && queryInvalidation && routeRefresh) {
    report(
      queryInvalidation,
      "mixed-cache-refresh",
      "one module must not invalidate TanStack Query and refresh the RSC route for the same mutation surface",
    );
  }
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
