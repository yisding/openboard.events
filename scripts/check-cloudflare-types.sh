#!/usr/bin/env bash
# Check the committed binding declarations in the same artifact-free state CI
# sees. Wrangler treats `.open-next/worker.js` as a local service implementation
# when it exists and emits declarations for that transient build instead of the
# clean-checkout service binding. Hide only that generated file for the check,
# then restore it even when Wrangler fails.
set -euo pipefail

worker_file=".open-next/worker.js"
mode="${1:---check}"
scratch_dir=""
env_file=""

[[ "$mode" == "--check" || "$mode" == "--write" ]] || {
  echo "usage: check-cloudflare-types.sh [--check|--write]" >&2
  exit 2
}

restore_worker() {
  if [[ -n "$scratch_dir" && -f "$scratch_dir/worker.js" ]]; then
    mkdir -p .open-next
    mv "$scratch_dir/worker.js" "$worker_file"
  fi
  [[ -z "$env_file" ]] || rm -f "$env_file"
  [[ -z "$scratch_dir" ]] || rmdir "$scratch_dir"
}
trap restore_worker EXIT INT TERM

scratch_root="${CLOUDFLARE_TYPES_TMP_ROOT:-${HOME:?HOME is required}/Code}"
# Suppress Wrangler's automatic .dev.vars/.env loading. Generated declarations
# describe committed config and bindings, never one developer's ignored keys.
mkdir -p .wrangler
env_file="$(mktemp .wrangler/typegen-clean.XXXXXX.env)"

if [[ -f "$worker_file" ]]; then
  mkdir -p "$scratch_root"
  scratch_dir="$(mktemp -d "$scratch_root/openboard-cloudflare-types.XXXXXX")"
  mv "$worker_file" "$scratch_dir/worker.js"
fi

args=(types --env-file "$env_file" --env-interface CloudflareEnv --include-runtime false cloudflare-env.d.ts)
[[ "$mode" == "--check" ]] && args+=(--check)
pnpm exec wrangler "${args[@]}"
