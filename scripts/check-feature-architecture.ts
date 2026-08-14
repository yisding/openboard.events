import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import ts from "typescript";

const REPO_ROOT = resolve(process.env.ARCHITECTURE_CHECK_ROOT ?? process.cwd());
const FEATURES_ROOT = resolve(REPO_ROOT, "src/features");
const BASELINE_PATH = resolve(REPO_ROOT, "architecture/feature-boundaries-baseline.json");
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

type ImportEdge = {
  source: string;
  sourceFeature: string;
  specifier: string;
  target: string | null;
  targetFeature: string | null;
};

type Baseline = {
  directCrossFeatureImports: string[];
  featureCycles: string[][];
  serverUiImports: string[];
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
      continue;
    }
    const extension = entry.name.endsWith(".tsx") ? ".tsx" : entry.name.endsWith(".ts") ? ".ts" : "";
    if (!SOURCE_EXTENSIONS.has(extension)) continue;
    if (/\.(?:test|spec)\.[jt]sx?$/u.test(entry.name)) continue;
    files.push(path);
  }
  return files.sort();
}

function importedSpecifiers(path: string): string[] {
  const text = readFileSync(path, "utf8");
  const source = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const specifiers = new Set<string>();

  function addLiteral(node: ts.Expression | undefined): void {
    if (node && ts.isStringLiteralLike(node)) specifiers.add(node.text);
  }

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      addLiteral(node.moduleSpecifier);
    } else if (ts.isCallExpression(node) && node.arguments.length > 0) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) addLiteral(node.arguments[0]);
      if (ts.isIdentifier(node.expression) && node.expression.text === "require") addLiteral(node.arguments[0]);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      addLiteral(node.argument.literal);
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
  return [...specifiers].sort();
}

function resolveLocalImport(source: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) {
    base = resolve(REPO_ROOT, "src", specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = resolve(dirname(source), specifier);
  } else {
    return null;
  }

  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    resolve(base, "index.ts"),
    resolve(base, "index.tsx"),
  ];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null;
}

function featureOwner(path: string | null): string | null {
  if (!path) return null;
  const inside = relative(FEATURES_ROOT, path);
  if (inside.startsWith("..") || inside === "") return null;
  return inside.split(sep)[0] ?? null;
}

function isPublicFeatureEntrypoint(path: string | null): boolean {
  if (!path) return false;
  const inside = relative(FEATURES_ROOT, path).split(sep).join("/");
  return /^[^/]+\/index(?:\.[^/]+)?\.[jt]sx?$/u.test(inside);
}

function isServerModule(path: string): boolean {
  const normalized = repoPath(path);
  return normalized.includes("/server/") || /\/server\.[jt]sx?$/u.test(normalized);
}

function isUiOrRouteModule(path: string | null): boolean {
  if (!path) return false;
  const normalized = repoPath(path);
  return normalized.includes("/components/")
    || normalized.startsWith("src/shared/ui/")
    || (/^src\/app\//u.test(normalized) && /\/route\.[jt]sx?$/u.test(normalized));
}

function importKey(edge: ImportEdge): string {
  return `${edge.source} -> ${edge.specifier}`;
}

function collectEdges(): ImportEdge[] {
  const edges: ImportEdge[] = [];
  for (const absoluteSource of sourceFiles(FEATURES_ROOT)) {
    const sourceFeature = featureOwner(absoluteSource);
    if (!sourceFeature) continue;
    for (const specifier of importedSpecifiers(absoluteSource)) {
      const target = resolveLocalImport(absoluteSource, specifier);
      edges.push({
        source: repoPath(absoluteSource),
        sourceFeature,
        specifier,
        target,
        targetFeature: featureOwner(target),
      });
    }
  }
  return edges;
}

function stronglyConnectedFeatures(edges: ImportEdge[]): string[][] {
  const graph = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!edge.targetFeature || edge.targetFeature === edge.sourceFeature) continue;
    if (!graph.has(edge.sourceFeature)) graph.set(edge.sourceFeature, new Set());
    if (!graph.has(edge.targetFeature)) graph.set(edge.targetFeature, new Set());
    graph.get(edge.sourceFeature)?.add(edge.targetFeature);
  }

  let nextIndex = 0;
  const index = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  function connect(node: string): void {
    index.set(node, nextIndex);
    lowLink.set(node, nextIndex);
    nextIndex += 1;
    stack.push(node);
    onStack.add(node);

    for (const target of graph.get(node) ?? []) {
      if (!index.has(target)) {
        connect(target);
        lowLink.set(node, Math.min(lowLink.get(node) ?? 0, lowLink.get(target) ?? 0));
      } else if (onStack.has(target)) {
        lowLink.set(node, Math.min(lowLink.get(node) ?? 0, index.get(target) ?? 0));
      }
    }

    if (lowLink.get(node) !== index.get(node)) return;
    const component: string[] = [];
    while (stack.length > 0) {
      const member = stack.pop();
      if (!member) break;
      onStack.delete(member);
      component.push(member);
      if (member === node) break;
    }
    if (component.length > 1) components.push(component.sort());
  }

  for (const node of [...graph.keys()].sort()) {
    if (!index.has(node)) connect(node);
  }
  return components.sort((left, right) => left.join("/").localeCompare(right.join("/")));
}

function currentBaseline(edges: ImportEdge[]): Baseline {
  const directCrossFeatureImports = edges
    .filter((edge) => edge.targetFeature && edge.targetFeature !== edge.sourceFeature)
    .filter((edge) => !isPublicFeatureEntrypoint(edge.target))
    .map(importKey)
    .sort();
  const serverUiImports = edges
    .filter((edge) => isServerModule(resolve(REPO_ROOT, edge.source)) && isUiOrRouteModule(edge.target))
    .map(importKey)
    .sort();
  return {
    directCrossFeatureImports,
    featureCycles: stronglyConnectedFeatures(edges),
    serverUiImports,
  };
}

function difference(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((item) => !rightSet.has(item));
}

function cycleKeys(cycles: string[][]): string[] {
  return cycles.map((cycle) => cycle.join(" -> ")).sort();
}

function dependencyCounts(edges: ImportEdge[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const edge of edges) {
    if (!edge.targetFeature || edge.targetFeature === edge.sourceFeature) continue;
    const key = `${edge.sourceFeature} -> ${edge.targetFeature}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function reportDrift(label: string, current: string[], baseline: string[]): boolean {
  const added = difference(current, baseline);
  const stale = difference(baseline, current);
  if (added.length === 0 && stale.length === 0) return false;
  console.error(`\n${label} baseline drift:`);
  for (const entry of added) console.error(`  + ${entry}`);
  for (const entry of stale) console.error(`  - ${entry}`);
  return true;
}

const edges = collectEdges();
const current = currentBaseline(edges);

if (process.argv.includes("--print-baseline")) {
  console.log(JSON.stringify(current, null, 2));
  process.exit(0);
}

if (process.argv.includes("--report")) {
  console.log("Feature dependency graph (production imports):");
  for (const [direction, count] of dependencyCounts(edges)) {
    console.log(`  ${direction}: ${count}`);
  }
  console.log("\nCyclic feature groups:");
  if (current.featureCycles.length === 0) console.log("  (none)");
  for (const cycle of cycleKeys(current.featureCycles)) console.log(`  ${cycle}`);
  console.log(`\nDirect cross-feature imports outside public entrypoints: ${current.directCrossFeatureImports.length}`);
  console.log(`Server-to-UI/route imports: ${current.serverUiImports.length}`);
  process.exit(0);
}

if (!existsSync(BASELINE_PATH)) {
  console.error("Feature architecture baseline is missing. Run pnpm architecture:report and review the result.");
  process.exit(2);
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Baseline;
let failed = false;
failed = reportDrift(
  "Direct cross-feature imports",
  current.directCrossFeatureImports,
  baseline.directCrossFeatureImports,
) || failed;
failed = reportDrift("Feature cycles", cycleKeys(current.featureCycles), cycleKeys(baseline.featureCycles)) || failed;
failed = reportDrift("Server-to-UI/route imports", current.serverUiImports, baseline.serverUiImports) || failed;

if (failed) {
  console.error("\nUpdate architecture intentionally: route cross-feature imports through a public index, remove cycles, and shrink the reviewed baseline.");
  process.exit(1);
}

console.log(
  `Feature architecture check passed: ${dependencyCounts(edges).length} dependency directions, `
  + `${current.directCrossFeatureImports.length} direct-import debts, `
  + `${current.featureCycles.length} cyclic ${current.featureCycles.length === 1 ? "group" : "groups"}, `
  + `${current.serverUiImports.length} server-to-UI/route debts.`,
);
