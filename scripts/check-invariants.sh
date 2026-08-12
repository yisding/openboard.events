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
# DD-2 (#116): one date idiom, and it names its zone. A native date input speaks
# wall-clock with no zone, so a deadline typed by an organizer outside the event
# zone lands hours from where they meant. `<DateTimePicker tz>` is the only
# control allowed to render one, because it is the only one that converts
# against the event's zone and shows the label.
#
# Two exemptions, both deliberate:
#   - the picker itself, which is the implementation;
#   - the form builder's `date` question, whose answer is a calendar date the
#     respondent picks (a birthday, a travel day). It is not an instant on the
#     event's clock and must not be converted as one.
#
# The pattern allows whitespace around `=` and either quote style, because
# `type = 'date'` is valid JSX and would otherwise walk straight past a check
# that only knows one spelling.
check_forbidden "type[[:space:]]*=[[:space:]]*[\"'](date|datetime-local)[\"']" src --glob '*.tsx' \
  --glob '!src/shared/ui/app/datetime-picker.tsx' \
  --glob '!src/features/forms/components/form-field-renderer.tsx'
check_forbidden "from ['\"]resend" src --glob '!src/features/comms/server/**'
# Grep #11: no direct R2 access outside the storage module. A hand-rolled presign
# elsewhere would bypass the kind policy, the key scheme and the finalize check.
# Match the module literal so compact/dynamic imports are covered, and the raw
# binding name so dot, destructured and computed access are all covered.
check_forbidden "['\"]aws4fetch['\"]" src --glob '!src/shared/server/r2.ts'
check_forbidden "\\bFILES\\b" src --glob '!src/shared/server/r2.ts'
check_forbidden "OPENBOARD_API_KEY" src docs/api.md .dev.vars.example
# M50: the reviewer-reachable admin surface is a closed list. `adminAuth` is
# organizer-only by default, and every route that lowers the bar to a reviewer
# is named here — a reviewer who can read an organizer surface (the speaker
# roster above all) can join names back to codes and titles and de-anonymize a
# blind round. Adding a route to this list is a deliberate, reviewed act.
check_forbidden "adminAuth\\(\\{[[:space:]]*role:[[:space:]]*['\"]reviewer" src \
  --glob '!src/app/api/internal/submissions/*/*/route.ts' \
  --glob '!src/app/api/internal/evaluation/*/queue/route.ts' \
  --glob '!src/app/api/internal/evaluation/*/reviews/route.ts' \
  --glob '!src/app/api/internal/evaluation/*/plans/*/recusals/route.ts' \
  --glob '!src/app/api/uploads/_lib.ts' \
  --glob '!src/features/auth/server/guards.test.ts'
check_forbidden "drizzle-kit[[:space:]]+push" package.json .github

if [[ "$fail" -ne 0 ]]; then
  echo "Invariant check failed"
  exit 1
fi

echo "Invariant check passed"
