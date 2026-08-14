#!/usr/bin/env bash
set -euo pipefail

server_fn=".open-next/server-functions/default"
meta="$server_fn/handler.mjs.meta.json"
chunk_dir="$server_fn/.next/server/chunks"

# ---------------------------------------------------------------------------
# Gate 1 — completeness. Every webpack server chunk must actually be inside the
# bundled Worker.
#
# This is not paranoia, it is a repeat of a real incident (4fe419a, reverted by
# b27539a). workerd cannot run webpack's dynamic chunk require, so
# `@opennextjs/cloudflare` rewrites it into a static switch built from
#
#     readdirSync(chunkDir).filter((chunk) => /^\d+\.js$/.test(chunk))
#
# (`dist/cli/build/patches/ast/webpack-runtime.js`). A split chunk with a
# *name* — anything `next.config.ts` gives a `name:` to — is emitted as
# `chunks/<name>.js`, fails that numeric filter, never enters the switch, and is
# therefore never seen by esbuild either. The Worker ships without it and the
# first request that needs it dies on `Unknown chunk <id>`. Because the chunk is
# missing rather than broken, `next build`, `vitest`, `pnpm bundle:client` and
# the size gate below all stay green — the size gate goes *greener*, since the
# artifact is smaller for exactly the wrong reason. The only signal was a
# deployed Worker answering every route with Next's static 500 page.
#
# So: compare the chunks on disk against the esbuild metafile's inputs. A chunk
# on disk that is not an input is a Worker that will 500, caught here instead of
# in production.
# ---------------------------------------------------------------------------
if [[ -d "$chunk_dir" && -f "$meta" ]]; then
  node --input-type=module -e '
    import { readFileSync, readdirSync } from "node:fs";
    const [meta, chunkDir] = process.argv.slice(1);
    const metafile = JSON.parse(readFileSync(meta, "utf8"));
    const output = Object.keys(metafile.outputs).find((name) => name.endsWith("handler.mjs"));
    if (!output) { console.error("check-worker-size: no handler.mjs output in " + meta); process.exit(2); }
    const bundled = new Set(
      Object.keys(metafile.outputs[output].inputs)
        .filter((input) => input.includes("/.next/server/chunks/"))
        .map((input) => input.split("/").pop())
    );
    const onDisk = readdirSync(chunkDir).filter((file) => file.endsWith(".js"));
    const missing = onDisk.filter((file) => !bundled.has(file));
    if (missing.length > 0) {
      console.error("Worker bundle is missing " + missing.length + " of " + onDisk.length + " server chunk(s):");
      for (const file of missing) console.error("  " + file);
      console.error("");
      console.error("Every request that needs one of these will fail with `Unknown chunk <id>`.");
      console.error("OpenNext only inlines chunks whose filename is purely numeric, so the usual");
      console.error("cause is a named splitChunks cacheGroup in next.config.ts. Remove the `name`");
      console.error("and let webpack keep the numeric chunk id.");
      process.exit(1);
    }
    console.log("Worker bundle contains all " + onDisk.length + " server chunks");
  ' "$meta" "$chunk_dir"
else
  echo "check-worker-size: no OpenNext server function found — run pnpm build:worker first" >&2
  exit 2
fi

# ---------------------------------------------------------------------------
# Gate 2 — size, against the Workers Free compressed limit.
#
# `wrangler` comes from node_modules/.bin, which only exists on PATH under a
# package-manager script (`pnpm worker:size`). Check for it before the pipeline
# below, because otherwise the shell's own "wrangler: command not found" is what
# `tee` writes into `.wrangler/worker-size.txt` — leaving a file that looks like
# a size measurement, is not one, and outlives the failed run. Fail closed with
# a message that names the fix instead, as check-invariants.sh does for rg.
# ---------------------------------------------------------------------------
command -v wrangler >/dev/null 2>&1 || {
  echo "check-worker-size: wrangler not on PATH — run this as \`pnpm worker:size\`" >&2
  exit 2
}

mkdir -p .wrangler
output_file=".wrangler/worker-size.txt"
worker_env="${WORKER_SIZE_ENV:-production}"
wrangler deploy --env "$worker_env" --dry-run 2>&1 | tee "$output_file"

gzip_kib=$(sed -nE 's/.*gzip[^0-9]*([0-9]+([.][0-9]+)?) KiB.*/\1/p' "$output_file" | tail -1)
[[ -n "$gzip_kib" ]] || { echo "Could not read compressed Worker size from Wrangler output" >&2; exit 2; }
upload_kib=$(sed -nE 's/.*Total Upload:[^0-9]*([0-9]+([.][0-9]+)?) KiB.*/\1/p' "$output_file" | tail -1)
[[ -n "$upload_kib" ]] || { echo "Could not read uncompressed Worker size from Wrangler output" >&2; exit 2; }

IFS=$'\t' read -r handler_inputs server_chunks static_assets < <(
  node --input-type=module -e '
    import { readFileSync, readdirSync } from "node:fs";
    import { join } from "node:path";
    const [metaPath, chunkDir, assetsDir] = process.argv.slice(1);
    const metafile = JSON.parse(readFileSync(metaPath, "utf8"));
    const output = Object.entries(metafile.outputs).find(([name]) => name.endsWith("handler.mjs"));
    if (!output) process.exit(2);
    const countFiles = (directory) => readdirSync(directory, { withFileTypes: true })
      .reduce((count, entry) => count + (entry.isDirectory() ? countFiles(join(directory, entry.name)) : 1), 0);
    process.stdout.write([
      Object.keys(output[1].inputs).length,
      readdirSync(chunkDir).filter((file) => file.endsWith(".js")).length,
      countFiles(assetsDir),
    ].join("\t") + "\n");
  ' "$meta" "$chunk_dir" .open-next/assets
)

next_version="$(node -p 'require("./node_modules/next/package.json").version')"
opennext_version="$(node -p 'require("./node_modules/@opennextjs/cloudflare/package.json").version')"
wrangler_version="$(node -p 'require("./node_modules/wrangler/package.json").version')"
compatibility_date="$(sed -nE 's/.*"compatibility_date"[[:space:]]*:[[:space:]]*"([0-9-]+)".*/\1/p' wrangler.jsonc | head -1)"

echo "Worker artifact metrics: env=$worker_env upload_kib=$upload_kib gzip_kib=$gzip_kib handler_inputs=$handler_inputs server_chunks=$server_chunks static_assets=$static_assets"
echo "Worker compatibility matrix: next=$next_version opennext=$opennext_version wrangler=$wrangler_version compatibility_date=$compatibility_date"

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    echo "### Worker artifact ($worker_env)"
    echo
    echo "| gzip KiB | upload KiB | handler inputs | server chunks | static assets |"
    echo "| ---: | ---: | ---: | ---: | ---: |"
    echo "| $gzip_kib | $upload_kib | $handler_inputs | $server_chunks | $static_assets |"
    echo
    echo "Next $next_version · OpenNext Cloudflare $opennext_version · Wrangler $wrangler_version · compatibility date $compatibility_date"
  } >> "$GITHUB_STEP_SUMMARY"
fi

awk -v size="$gzip_kib" 'BEGIN {
  if (size > 3072) { printf "Worker %.2f KiB exceeds the Workers Free 3072 KiB limit\n", size > "/dev/stderr"; exit 1 }
  if (size > 2560) { printf "warning: Worker %.2f KiB is above the 2560 KiB upgrade threshold\n", size > "/dev/stderr" }
  else { printf "Worker %.2f KiB is within the Workers Free size budget\n", size }
}'
