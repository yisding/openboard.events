#!/usr/bin/env bash
#
# The curl block from docs/api.md, extracted so it can be RUN rather than read.
# This is M40's named acceptance check: every documented command executes once
# against a live deployment and its status code is asserted — all 200s, plus
# the deliberate 401s and the deliberate 404 the doc promises.
#
#   export APP_BASE_URL='https://sb-web-preview.yi-ding.workers.dev'
#   export SLUG='ai-engineer'
#   export KEY='ob_live_...'        # Settings → API keys; shown once, at creation
#   bash docs/api-examples.sh
#
# Set SKIP_KEYED=1 to run only the unkeyed half (no key needed).
# Exits non-zero on the first mismatch, listing every failure at the end.

set -uo pipefail

: "${APP_BASE_URL:?set APP_BASE_URL to the deployment origin, e.g. https://sb-web-preview.yi-ding.workers.dev}"
: "${SLUG:?set SLUG to a seeded event slug, e.g. ai-engineer}"
SKIP_KEYED="${SKIP_KEYED:-0}"
if [[ "$SKIP_KEYED" != "1" ]]; then
  : "${KEY:?set KEY to an API key for the SLUG event, or SKIP_KEYED=1 to run the unkeyed half only}"
fi

command -v curl >/dev/null || { echo "api-examples: curl is required" >&2; exit 2; }
command -v jq   >/dev/null || { echo "api-examples: jq is required" >&2; exit 2; }

failures=0
pass() { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1" >&2; failures=$((failures + 1)); }

# expect <expected-status> <label> <curl args...>
# The status is appended after a marker rather than a newline so a body that
# ends in whitespace (or contains one) cannot confuse the split.
expect() {
  local want="$1" label="$2"; shift 2
  local out body status
  out=$(curl -s -w '__HTTP_STATUS__%{http_code}' "$@")
  status="${out##*__HTTP_STATUS__}"
  body="${out%__HTTP_STATUS__*}"
  if [[ "$status" == "$want" ]]; then
    pass "$label ($status)"
    LAST_BODY="$body"
    return 0
  fi
  fail "$label — expected $want, got $status"
  printf '       %s\n' "${body:0:400}" >&2
  LAST_BODY=""
  return 1
}

# expect_jq <label> <jq filter> <expected output>  — run against LAST_BODY
expect_jq() {
  local label="$1" filter="$2" want="$3" got
  got=$(printf '%s' "$LAST_BODY" | jq -r "$filter" 2>/dev/null)
  if [[ "$got" == "$want" ]]; then
    pass "$label"
  else
    fail "$label — expected '$want', got '$got'"
  fi
}

echo "== Unkeyed — published data =="

expect 200 "GET /events/\$SLUG" "$APP_BASE_URL/api/v1/events/$SLUG"
expect_jq "  slug matches" '.data.slug' "$SLUG"

expect 200 "GET /events/\$SLUG/schedule" "$APP_BASE_URL/api/v1/events/$SLUG/schedule"
expect_jq "  meta.event.slug matches" '.meta.event.slug' "$SLUG"

expect 200 "GET /events/\$SLUG/speakers" "$APP_BASE_URL/api/v1/events/$SLUG/speakers"
expect_jq "  data is an array" '.data | type' "array"

# Cache + CORS headers, on every unkeyed response.
headers=$(curl -sI "$APP_BASE_URL/api/v1/events/$SLUG")
grep -qi 'access-control-allow-origin: \*' <<<"$headers" \
  && pass "unkeyed CORS header" || fail "unkeyed CORS header missing"
grep -qi 'cache-control:.*s-maxage=60' <<<"$headers" \
  && pass "unkeyed edge cache header" || fail "unkeyed edge cache header missing"

# Unknown slug → 404, never a 200 with empty data.
expect 404 "GET /events/does-not-exist → 404" "$APP_BASE_URL/api/v1/events/does-not-exist"
expect_jq "  error code" '.error.code' "NOT_FOUND"

# Preflight.
expect 204 "OPTIONS /events/\$SLUG → 204" -X OPTIONS "$APP_BASE_URL/api/v1/events/$SLUG"

echo "== Keyed — an event's own data =="

# A bad key is rejected with 401 before any 404 — a key-less caller learns
# nothing about whether a slug exists. This one runs even without a real KEY.
expect 401 "bad key → 401 (deliberate)" -H 'Authorization: Bearer nope' "$APP_BASE_URL/api/v1/events/$SLUG/stats"
expect_jq "  error code" '.error.code' "UNAUTHORIZED"
expect 401 "no key → 401 (deliberate)" "$APP_BASE_URL/api/v1/events/$SLUG/stats"
expect 401 "bad key on unknown slug → 401 before 404 (deliberate)" \
  -H 'Authorization: Bearer nope' "$APP_BASE_URL/api/v1/events/does-not-exist/stats"

if [[ "$SKIP_KEYED" == "1" ]]; then
  echo "  (SKIP_KEYED=1 — skipping the authenticated calls)"
else
  auth=(-H "Authorization: Bearer $KEY")

  expect 200 "GET /events/\$SLUG/stats" "${auth[@]}" "$APP_BASE_URL/api/v1/events/$SLUG/stats"
  expect_jq "  keys are kpis/speakerTracking/statusCounts" \
    '.data | keys_unsorted | sort | join(",")' "kpis,speakerTracking,statusCounts"

  expect 200 "GET /events/\$SLUG/submissions" "${auth[@]}" "$APP_BASE_URL/api/v1/events/$SLUG/submissions"
  expect_jq "  zero drafts with no status filter at all" \
    '[.data[] | select(.status=="draft")] | length' "0"

  # A cursor page: .meta.nextCursor is the code of the last row on the page.
  page1_cursor=$(printf '%s' "$LAST_BODY" | jq -r '.meta.nextCursor // empty')
  if [[ -n "$page1_cursor" ]]; then
    expect 200 "GET /events/\$SLUG/submissions?limit=1&cursor=…" \
      "${auth[@]}" "$APP_BASE_URL/api/v1/events/$SLUG/submissions?limit=1&cursor=$page1_cursor"
  fi

  # ?status=draft is rejected — there is no way to ask this endpoint for drafts.
  expect 400 "GET /submissions?status=draft → 400 (deliberate)" \
    "${auth[@]}" "$APP_BASE_URL/api/v1/events/$SLUG/submissions?status=draft"
  expect_jq "  error code" '.error.code' "VALIDATION"

  expect 200 "GET /events/\$SLUG/speakers/outstanding-tasks" \
    "${auth[@]}" "$APP_BASE_URL/api/v1/events/$SLUG/speakers/outstanding-tasks"
  expect_jq "  data is an array" '.data | type' "array"

  expect 200 "GET /events/\$SLUG/comms-log?limit=20" \
    "${auth[@]}" "$APP_BASE_URL/api/v1/events/$SLUG/comms-log?limit=20"
  # Never a rendered subject or body: either can carry a live magic link.
  expect_jq "  no rendered subject/body serialized" \
    '[.data[] | keys[]] | unique | map(select(. == "subjectRendered" or . == "bodyRenderedHtml")) | length' "0"

  keyed_headers=$(curl -sI "${auth[@]}" "$APP_BASE_URL/api/v1/events/$SLUG/stats")
  grep -qi 'cache-control:.*no-store' <<<"$keyed_headers" \
    && pass "keyed no-store header" || fail "keyed response is missing 'private, no-store'"
fi

echo
if (( failures > 0 )); then
  echo "api-examples: $failures check(s) failed" >&2
  exit 1
fi
echo "api-examples: all checks passed"
