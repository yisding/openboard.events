import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

/**
 * `src/app/globals.css` opens with "Every colour in this stylesheet resolves to
 * one of these", and `--on-dark-muted`'s published contrast ratios are computed
 * from the gradient stops named in that same block. A raw hex several hundred
 * lines below is what breaks both: it is a colour with no name, and editing it
 * silently invalidates a ratio recorded somewhere else. So `:root` is the only
 * place a hex may be spelled out.
 *
 * Comments and `url("data:...")` payloads are exempt: a data URI cannot read a
 * custom property (the chevron glyph says so where it is declared), and issue
 * references like `#117` are prose, not colour.
 */
const REPO_ROOT = resolve(process.env.SOURCE_INVARIANT_ROOT ?? process.cwd());
const SOURCE_ROOT = resolve(REPO_ROOT, "src");

/** Declarations where a hex is not a colour the design system owns. */
const EXEMPT_DECLARATIONS = [
  // Mask stops read as alpha, not paint: #000 means "keep", not "black".
  "mask-image:linear-gradient(to right,#000,transparent)",
];

const HEX = /#[0-9a-fA-F]{3,8}\b/g;

function repoPath(path: string): string {
  return relative(REPO_ROOT, path).split(sep).join("/");
}

function stylesheets(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...stylesheets(path));
    else if (entry.name.endsWith(".css")) files.push(path);
  }
  return files.sort();
}

/** Blanks a region to spaces so every later offset still maps to its own line. */
function blank(css: string, pattern: RegExp): string {
  return css.replace(pattern, (match) => match.replaceAll(/[^\n]/g, " "));
}

function scannable(css: string): string {
  let text = blank(css, /\/\*[\s\S]*?\*\//g);
  text = blank(text, /url\(["']?data:[^)]*\)/g);
  text = blank(text, /^:root\s*\{[\s\S]*?^\}/gm);
  for (const declaration of EXEMPT_DECLARATIONS) {
    text = blank(text, new RegExp(declaration.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`), "g"));
  }
  return text;
}

const violations: string[] = [];
for (const path of stylesheets(SOURCE_ROOT)) {
  const css = readFileSync(path, "utf8");
  const text = scannable(css);
  for (const match of text.matchAll(HEX)) {
    const line = text.slice(0, match.index).split("\n").length;
    violations.push(`${repoPath(path)}:${line} raw colour ${match[0]} — declare it in :root and reference the token`);
  }
}

if (violations.length > 0) {
  for (const violation of violations) console.error(violation);
  console.error(`CSS colour token check failed (${violations.length} violation${violations.length === 1 ? "" : "s"})`);
  process.exit(1);
}
