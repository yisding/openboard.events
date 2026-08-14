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
# DD-1 (#115): one dropdown design. A raw `<select>` renders the operating
# system's arrow and popup next to designed controls, which is the most repeated
# visual inconsistency the product had. `<Select>` from the kit is a native
# select underneath — it keeps type-ahead, Esc and the mobile picker — but wears
# the kit's chrome. The kit itself is the one place the raw element may appear.
check_forbidden "<select[[:space:]/>]" src --glob '*.tsx' --glob '!src/shared/ui/ui-kit.tsx'
# DD-3: one interactive switch contract. A hand-authored `role="switch"`
# duplicates the kit's accessible name, checked-state and visual-class wiring;
# keep that behavior centralized in `<Switch>`. Static indicators and radio
# groups remain separate because neither exposes the switch role.
check_forbidden "role[[:space:]]*=[[:space:]]*\\{?[[:space:]]*['\"]switch['\"]" src \
  --glob '*.tsx' \
  --glob '!**/*.test.tsx' \
  --glob '!src/shared/ui/ui-kit.tsx'
# DD-2 (#116): one date idiom, and event instants name their zone. Native date
# controls expose an unstyleable operating-system calendar and datetime-local
# speaks wall-clock with no zone. The shared picker now renders a themed text
# trigger plus an application-owned calendar, so no native date input needs an
# exemption — not even participant-authored calendar-day questions.
#
# `DATE_ATTR` matches the JSX attribute rather than arbitrary text:
#   - the leading class rejects `data-type=` and `mytype=` while allowing the
#     attribute at a line start or after whitespace, `<`, `{` or `;`;
#   - `\{?` also catches the expression form `type={"date"}`;
#   - `-U` lets `[[:space:]]` cross newlines, so an attribute broken over two
#     lines cannot slip through.
#
# A computed value (`type={cond ? "date" : x}`) still escapes a grep; that is the
# known ceiling of a regex check, and the reason the two exemptions above are
# written as globs a reviewer must consciously widen.
DATE_ATTR_PREFIX="(^|[^-[:alnum:]_])type[[:space:]]*=[[:space:]]*\{?[[:space:]]*[\"'\`]"
check_forbidden "${DATE_ATTR_PREFIX}datetime-local[\"'\`]" src -U --glob '*.tsx'
check_forbidden "${DATE_ATTR_PREFIX}date[\"'\`]" src -U --glob '*.tsx'
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

# Design Phase 1: meaningful interface copy has a 12px floor. The landing
# page's scaled product illustration is the only exception: those preview and
# floating-card labels are decorative pixels inside a miniature, not controls.
# Fail closed: every CSS font-size must be one of the named type tokens,
# `inherit`, the approved hero clamp, or a pixel literal at least 12px. This
# also rejects alternate sub-floor units and expressions such as .5rem, 8pt,
# or calc(10px). Inline React styles use the same floor so a component cannot
# bypass the CSS scale with a numeric value.
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
inline_type_pattern='fontSize[[:space:]]*:[[:space:]]*-?([0-9]+([.][0-9]+)?|[.][0-9]+)'
set +e
inline_type_output=$(rg -n -o "$inline_type_pattern" src --glob '*.ts' --glob '*.tsx' 2>&1)
inline_type_status=$?
set -e
if (( inline_type_status > 1 )); then
  echo "check-invariants: rg failed (exit $inline_type_status) for the inline type floor" >&2
  echo "$inline_type_output" >&2
  exit 2
fi
if (( inline_type_status == 0 )); then
  while IFS= read -r match; do
    declaration=${match#*:*:}
    value=${declaration#*:}
    value=$(printf '%s' "$value" | tr -d '[:space:]')
    if ! awk -v size="$value" 'BEGIN { exit !(size >= 12) }'; then
      echo "$match"
      fail=1
    fi
  done <<< "$inline_type_output"
fi

if [[ "$fail" -ne 0 ]]; then
  echo "Invariant check failed"
  exit 1
fi

echo "Invariant check passed"
