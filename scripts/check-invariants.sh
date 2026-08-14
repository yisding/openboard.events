#!/usr/bin/env bash
set -euo pipefail

command -v rg >/dev/null 2>&1 || { echo "check-invariants: ripgrep (rg) is required" >&2; exit 2; }
[[ -d src ]] || { echo "check-invariants: src directory not found" >&2; exit 2; }

fail=0

# Syntax-sensitive source policies live in the TypeScript AST checker. Keep
# this shell wrapper for repository literals and the CSS declaration floor.
node_modules/.bin/tsx scripts/check-source-invariants.ts

# rg exits 0 on match, 1 on no match, >1 on operational error. Only exit 1 is
# success here; anything else means the check did not run and must fail closed.
check_forbidden() {
  local pattern="$1"
  shift
  local output status
  set +e
  output=$(rg -n "$pattern" "$@" 2>&1)
  status=$?
  set -e
  if (( status > 1 )); then
    echo "check-invariants: rg failed (exit $status) for pattern: $pattern" >&2
    echo "$output" >&2
    exit 2
  fi
  if (( status == 0 )); then
    echo "$output"
    fail=1
  fi
}

check_forbidden "OPENBOARD_API_KEY" src docs/api.md .dev.vars.example
check_forbidden "drizzle-kit[[:space:]]+push" package.json .github
check_forbidden "NEXT_PUBLIC_BUILD_SHA" src scripts tests docs .github .dev.vars.example --glob '!check-invariants.sh'

# Design Phase 1: meaningful interface copy has a 12px floor. The landing
# page's scaled product illustration is the only exception: those preview and
# floating-card labels are decorative pixels inside a miniature, not controls.
# Fail closed: every CSS font-size must be one of the named type tokens,
# `inherit`, the approved hero clamp, or a pixel literal at least 12px. This
# also rejects alternate sub-floor units and expressions such as .5rem, 8pt,
# or calc(10px). Inline React styles are covered by the AST checker above.
type_floor_pattern="font-size[[:space:]]*:[[:space:]]*[^;}]+"
set +e
type_floor_output=$(rg -n -o "$type_floor_pattern" src --glob '*.css' 2>&1)
type_floor_status=$?
set -e
if (( type_floor_status > 1 )); then
  echo "check-invariants: rg failed (exit $type_floor_status) for the CSS type floor" >&2
  echo "$type_floor_output" >&2
  exit 2
fi
if (( type_floor_status == 0 )); then
  while IFS= read -r match; do
    path=${match%%:*}
    match_without_path=${match#*:}
    line_number=${match_without_path%%:*}
    declaration=${match_without_path#*:}
    value=${declaration#*:}
    value=$(printf '%s' "$value" | tr -d '[:space:]')

    case "$value" in
      'var(--text-xs)'|'var(--text-sm)'|'var(--text-base)'|'var(--text-table)'|'var(--text-sm)!important'|'inherit'|'clamp(40px,5vw,72px)')
        continue
        ;;
    esac

    if [[ "$value" =~ ^([0-9]+([.][0-9]+)?)px$ ]] && awk -v size="${BASH_REMATCH[1]}" 'BEGIN { exit !(size >= 12) }'; then
      continue
    fi

    if [[ "$value" == '10px' && "$path" == 'src/app/globals.css' ]]; then
      source_line=$(sed -n "${line_number}p" "$path")
      if [[ "$source_line" =~ ^\.(preview-chrome|preview-heading[[:space:]]+\.preview-add|preview-stats[[:space:]]+(small|em)|preview-list[[:space:]]+\>[[:space:]]+div|floating-card[[:space:]]+small)[[:space:]]*\{ ]]; then
        continue
      fi
    fi

    echo "$match"
    fail=1
  done <<< "$type_floor_output"
fi
if [[ "$fail" -ne 0 ]]; then
  echo "Invariant check failed"
  exit 1
fi

echo "Invariant check passed"
