#!/usr/bin/env bash
set -euo pipefail

command -v rg >/dev/null 2>&1 || { echo "check-invariants: ripgrep (rg) is required" >&2; exit 2; }
[[ -d src ]] || { echo "check-invariants: src directory not found" >&2; exit 2; }

fail=0

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

check_forbidden "dangerouslySetInnerHTML" src --glob '*.tsx' --glob '!src/shared/ui/app/rich-text-view.tsx'
check_forbidden "runtime\\s*=\\s*['\"]edge" src
check_forbidden "process\\.env\\." src --glob '!src/shared/lib/env.ts' --glob '!src/app/page.tsx'
check_forbidden "from ['\"](date-fns|date-fns-tz)" src --glob '!src/shared/lib/time.ts'
check_forbidden "from ['\"]resend" src --glob '!src/features/comms/server/**'
check_forbidden "OPENBOARD_API_KEY" src docs/api.md .dev.vars.example
check_forbidden "drizzle-kit[[:space:]]+push" package.json .github

if [[ "$fail" -ne 0 ]]; then
  echo "Invariant check failed"
  exit 1
fi

echo "Invariant check passed"
