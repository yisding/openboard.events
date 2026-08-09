import { gzipSync } from "node:zlib";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * M05b step 4 — the **browser** budget. It is a different artifact from the
 * compressed Worker that `check-worker-size.sh` gates, and the two must never
 * share a threshold: the editor loads through `next/dynamic` with `ssr: false`,
 * so it is deliberately absent from the server bundle and invisible to that gate.
 *
 * Measured here:
 *   - first-load JS for the route that imports the editor (budget 300 KB gzip,
 *     warn at 250 KB), and
 *   - the lazy editor chunk a writer downloads when they open it, reported so a
 *     regression is visible even though it is not first-load.
 */
const ROUTE = process.env.CLIENT_BUNDLE_ROUTE ?? "/kitchen-sink/rich/page";
const BUDGET_KB = Number(process.env.CLIENT_BUNDLE_BUDGET_KB ?? 300);
const WARN_KB = Number(process.env.CLIENT_BUNDLE_WARN_KB ?? 250);
const NEXT_DIR = ".next";

function gzipKb(path: string): number {
  return gzipSync(readFileSync(path), { level: 9 }).byteLength / 1024;
}

function main(): void {
  const manifestPath = join(NEXT_DIR, "app-build-manifest.json");
  try {
    statSync(manifestPath);
  } catch {
    console.error(`${manifestPath} not found — run pnpm build first`);
    process.exitCode = 2;
    return;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { pages: Record<string, string[]> };
  const files = manifest.pages[ROUTE];
  if (!files) {
    console.error(`route ${ROUTE} is not in the build manifest; known routes:\n  ${Object.keys(manifest.pages).join("\n  ")}`);
    process.exitCode = 2;
    return;
  }

  const firstLoadKb = files.reduce((total, file) => total + gzipKb(join(NEXT_DIR, file)), 0);

  // The editor arrives as its own chunk, which app-build-manifest does not list
  // precisely because it is not first-load. Measuring it anyway is what makes a
  // regression visible: "not first-load" is not the same as "free".
  const chunkDir = join(NEXT_DIR, "static", "chunks");
  let editorChunkKb = 0;
  for (const file of readdirSync(chunkDir, { recursive: true, encoding: "utf8" })) {
    if (!file.endsWith(".js")) continue;
    const path = join(chunkDir, file);
    if (statSync(path).isDirectory()) continue;
    const source = readFileSync(path, "utf8");
    if (source.includes("prosemirror") || source.includes("ProseMirror")) {
      editorChunkKb = Math.max(editorChunkKb, gzipKb(path));
    }
  }

  console.log(`first-load JS for ${ROUTE}: ${firstLoadKb.toFixed(1)} KB gzip (budget ${BUDGET_KB} KB, warn ${WARN_KB} KB)`);
  console.log(editorChunkKb > 0
    ? `lazy editor chunk: ${editorChunkKb.toFixed(1)} KB gzip — downloaded only when the editor opens`
    : "lazy editor chunk: not found in first-load graph, which is the point of ssr:false");

  if (firstLoadKb > BUDGET_KB) {
    console.error(`first-load JS exceeds the ${BUDGET_KB} KB budget; drop editor extensions (blockquote and code first) or fall back to the plain textarea`);
    process.exitCode = 1;
    return;
  }
  if (firstLoadKb > WARN_KB) console.warn(`warning: first-load JS is above the ${WARN_KB} KB threshold`);
}

main();
