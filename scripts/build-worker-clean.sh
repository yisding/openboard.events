#!/usr/bin/env bash
# Run the Worker build (or an explicit OpenNext release command) without
# allowing ignored developer env files to influence it. OpenNext asks Wrangler
# to read the project config, and Wrangler otherwise discovers `.dev.vars` even
# for a build; Next itself also discovers `.env*`. Deploys receive their public
# build inputs through process.env and runtime secrets through Cloudflare
# bindings, so neither class of local file belongs in a reproducible release.
set -euo pipefail

if [[ "${1:-}" == "--command" ]]; then
  shift
  (( $# > 0 )) || {
    echo "usage: build-worker-clean.sh --command command [args...]" >&2
    exit 2
  }
  command_to_run=("$@")
else
  command_to_run=(pnpm exec opennextjs-cloudflare build "$@")
fi

scratch_root="${WORKER_BUILD_TMP_ROOT:-${HOME:?HOME is required}/Code}"
mkdir -p "$scratch_root"
scratch_dir="$(mktemp -d "$scratch_root/openboard-worker-build.XXXXXX")"
isolated_files=()

restore_env_files() {
  local status=$?
  local restore_failed=0
  local env_file
  set +e
  for env_file in "${isolated_files[@]}"; do
    if [[ -e "$env_file" ]]; then
      echo "refusing to overwrite $env_file while restoring the isolated original; recovery copy remains in $scratch_dir" >&2
      restore_failed=1
    elif ! mv -- "$scratch_dir/$env_file" "$env_file"; then
      echo "failed to restore $env_file; recovery copy remains in $scratch_dir" >&2
      restore_failed=1
    fi
  done
  if (( restore_failed == 0 )); then
    rmdir "$scratch_dir"
  elif (( status == 0 )); then
    status=1
  fi
  trap - EXIT INT TERM
  exit "$status"
}
trap restore_env_files EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

shopt -s nullglob
for env_file in .dev.vars .dev.vars.* .env .env.*; do
  [[ -f "$env_file" ]] || continue
  # Keep committed examples and any future intentionally tracked config in
  # place. Only ignored, developer-owned input is isolated.
  if git check-ignore -q -- "$env_file"; then
    mv -- "$env_file" "$scratch_dir/$env_file"
    isolated_files+=("$env_file")
  fi
done

if (( ${#isolated_files[@]} > 0 )); then
  echo "isolated ${#isolated_files[@]} ignored local env file(s) from the OpenNext command"
fi

"${command_to_run[@]}"
