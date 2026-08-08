#!/usr/bin/env bash
set -euo pipefail

fail=0

check_forbidden() {
  local pattern="$1"
  shift
  local output
  output=$(rg -n "$pattern" "$@" 2>/dev/null || true)
  if [[ -n "$output" ]]; then
    echo "$output"
    fail=1
  fi
}

unsafe=$(rg -n "dangerouslySetInnerHTML" src --glob '*.tsx' --glob '!src/shared/ui/app/rich-text-view.tsx' || true)
if [[ -n "$unsafe" ]]; then echo "$unsafe"; fail=1; fi

check_forbidden "runtime\\s*=\\s*['\"]edge" src
check_forbidden "from ['\"](date-fns|date-fns-tz)" src --glob '!src/shared/lib/time.ts'
check_forbidden "from ['\"]resend" src --glob '!src/features/comms/server/**'

if [[ "$fail" -ne 0 ]]; then
  echo "Invariant check failed"
  exit 1
fi

echo "Invariant check passed"
