#!/usr/bin/env bash
#
# M10 step 8 — the only thing that proves the *deployed artifact* is correct.
# CI's Playwright runs against `next start`, not workerd, and the
# "works in next dev, dies in workerd" class of bug lives exactly in that gap.
#
#   bash scripts/post-deploy-smoke.sh https://sb-web-preview.yi-ding.workers.dev
#   bash scripts/post-deploy-smoke.sh https://<prod> --production
#
# Exits non-zero on the first failure, printing the URL and the response headers.
# A check whose seeded artifact does not exist yet is SKIPPED out loud and
# counted; --strict turns any skip into a failure, which is how CP4 runs it.
set -uo pipefail

base_url="${1:?usage: post-deploy-smoke.sh URL [--production] [--strict]}"
shift || true
base_url="${base_url%/}"

production=0
strict=0
for arg in "$@"; do
  case "$arg" in
    --production) production=1 ;;
    --strict) strict=1 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

# Seeded artifacts. The deploy workflow derives the ids from the seed source
# (scripts/print-smoke-fixture-ids.ts) unless the protected environment sets its
# own; --strict makes a missing fixture a failed deployment rather than a silent
# reduction in coverage. The deterministic M09 public-event slug is safe to
# default here.
event_slug="${SMOKE_EVENT_SLUG:-ai-engineer-sandbox-event}"
event_id="${SMOKE_EVENT_ID:-}"
form_id="${SMOKE_FORM_ID:-}"
headshot_file_id="${SMOKE_HEADSHOT_FILE_ID:-}"

failures=0
skips=0
headers_file="$(mktemp)"
body_file="$(mktemp)"
trap 'rm -f "$headers_file" "$body_file"' EXIT

# Fetches once into $headers_file/$body_file and stores the status code, so no
# assertion costs a second request. Calling this function directly preserves
# last_url; command substitution would run it in a subshell and discard that
# diagnostic state before a later header/body assertion failed.
last_url=""
last_status=""
fetch() {
  last_url="$1"
  last_status="$(curl -sS -o "$body_file" -D "$headers_file" -w '%{http_code}' --max-time 30 "$1" 2>/dev/null)" \
    || last_status="000"
}

fail() {
  local url="$1" what="$2"
  echo "FAIL  $what"
  echo "      ${url:-$last_url}"
  sed 's/^/      /' "$headers_file" | head -20
  failures=$((failures + 1))
}

pass() { echo "ok    $1"; }

skip() {
  if (( strict )); then
    echo "FAIL  $1 (skipped, and --strict is on)"
    failures=$((failures + 1))
  else
    echo "SKIP  $1 — $2"
    skips=$((skips + 1))
  fi
}

# A header value, lowercased, with the name stripped. Empty when absent.
header_value() {
  tr -d '\r' < "$headers_file" | grep -i "^$1:" | head -1 | cut -d: -f2- | sed 's/^ *//' | tr '[:upper:]' '[:lower:]'
}

# OpenNext exposes two valid forms of the same edge-cache contract. A fresh
# render carries s-maxage for the cache to store. Once that entry is served by
# the incremental cache, OpenNext can omit Cache-Control and report HIT or
# STALE in x-nextjs-cache instead. Requiring s-maxage on that cached response
# turns a healthy cache hit (or stale-while-revalidate response) into a failed
# deployment.
is_edge_cached() {
  local cache_control next_cache
  cache_control="$(header_value cache-control)"
  next_cache="$(header_value x-nextjs-cache)"
  [[ "$cache_control" == *"s-maxage="* || "$next_cache" == "hit" || "$next_cache" == "stale" ]]
}

expect_status() {
  local url="$1" expected="$2" what="$3"
  local status
  fetch "$url"
  status="$last_status"
  if [[ "$status" != "$expected" ]]; then
    fail "$url" "$what (expected $expected, got $status)"
    return 1
  fi
  return 0
}

expect_body() {
  local pattern="$1" what="$2"
  if ! grep -qEi -- "$pattern" "$body_file"; then
    fail "" "$what (body does not match '$pattern')"
    return 1
  fi
  return 0
}

expect_header() {
  local name="$1" pattern="$2" what="$3"
  local value
  value="$(header_value "$name")"
  if [[ "$value" != *"$pattern"* ]]; then
    fail "" "$what ($name is '${value:-absent}', expected to contain '$pattern')"
    return 1
  fi
  return 0
}

expect_no_header() {
  local name="$1" what="$2"
  local value
  value="$(header_value "$name")"
  if [[ -n "$value" ]]; then
    fail "" "$what ($name is present: '$value')"
    return 1
  fi
  return 0
}

echo "post-deploy smoke against $base_url"
echo

# 1. Health, including the database round-trip timing.
if expect_status "$base_url/api/health" 200 "health responds"; then
  expect_body '"ok":true' "health reports ok" \
    && expect_body 'ms' "health reports a database timing" \
    && expect_body '"errors":\{"ok":true' "health reports operational error tracking" \
    && expect_body '"jobs":\{"ok":true' "health reports scheduled-job heartbeat tracking" \
    && pass "/api/health"
fi

# 1b. Both deployed environments advertise self-service signup, so Better
# Auth's non-mutating session endpoint must be mounted. The fallback provider
# returns 404 here; checking this catches a deployment that renders `/signup`
# but cannot accept the form before a smoke test creates any customer data.
if expect_status "$base_url/api/auth/get-session" 200 "self-service auth is mounted"; then
  pass "/api/auth/get-session"
fi

# 2. The public schedule is cached at the edge. Two things this deliberately does
#    not assert: the literal s-maxage=60 (OpenNext counts it down as the entry
#    ages, so a page rendered 58 seconds ago honestly answers s-maxage=2), and
#    Cache-Control's presence on a cached response. OpenNext can serve an ISR
#    entry as HIT or STALE with no Cache-Control at all; x-nextjs-cache is the
#    authoritative signal in that case. Cold responses are still retried, and
#    only a page with neither signal fails.
#    M53 renamed the canonical surface to /agenda; the legacy /schedule URL must
#    keep answering with a redirect so old links and embeds never break.
schedule_ok=0
for attempt in 1 2 3 4 5; do
  # Retryable probes use fetch directly: expect_status records a permanent
  # failure, which would make a transient 503 fail the whole run even when a
  # later attempt succeeds.
  fetch "$base_url/e/$event_slug/agenda"
  if [[ "$last_status" == "200" ]]; then
    if is_edge_cached; then schedule_ok=1; break; fi
  fi
  if (( attempt < 5 )); then sleep 2; fi
done
if (( schedule_ok )); then
  pass "/e/$event_slug/agenda"
elif [[ "$last_status" != "200" ]]; then
  fail "$base_url/e/$event_slug/agenda" "public agenda renders (expected 200 after 5 attempts, got $last_status)"
else
  fail "$base_url/e/$event_slug/agenda" "public agenda is edge-cached (no s-maxage or OpenNext cache state after 5 attempts)"
fi

# 2b. The legacy public URL redirects rather than 404s.
if expect_status "$base_url/e/$event_slug/schedule" 307 "legacy /schedule redirects to the M53 surface"; then
  pass "/e/$event_slug/schedule (307 legacy redirect)"
fi

# 3. The embed variant must be framable: CSP allows any ancestor and the legacy
#    header is absent. Both together is the classic blank-iframe failure.
#    The M53 embed pages used to read their appearance options from
#    searchParams, which forced dynamic rendering and lost the edge cache the
#    /e/* pages have (status rev. 11's recorded regression). They now read
#    style from the saved `embeds` row instead, same as filters and the kill
#    switch already did — so this asserts s-maxage on the embed too, with the
#    same cache-state retry as check 2.
embed_ok=0
for attempt in 1 2 3 4 5; do
  fetch "$base_url/embed/$event_slug/agenda"
  if [[ "$last_status" == "200" ]]; then
    if is_edge_cached; then embed_ok=1; break; fi
  fi
  if (( attempt < 5 )); then sleep 2; fi
done
if (( embed_ok )); then
  expect_header "content-security-policy" "frame-ancestors *" "embed allows framing" \
    && expect_no_header "x-frame-options" "embed does not send X-Frame-Options" \
    && pass "/embed/$event_slug/agenda"
elif [[ "$last_status" != "200" ]]; then
  fail "$base_url/embed/$event_slug/agenda" "embed renders (expected 200 after 5 attempts, got $last_status)"
else
  fail "$base_url/embed/$event_slug/agenda" "embed is edge-cached (no s-maxage or OpenNext cache state after 5 attempts)"
fi

# 4. The public API answers with an envelope.
if expect_status "$base_url/api/v1/events/$event_slug/schedule" 200 "public API responds"; then
  expect_body '"data"' "public API returns an envelope" \
    && pass "/api/v1/events/$event_slug/schedule"
fi

# 5. The admin gate is live on the deployed artifact, not just in dev.
if [[ -n "$event_id" ]]; then
  fetch "$base_url/events/$event_id/dashboard"
  status="$last_status"
  if [[ "$status" == "307" || "$status" == "302" ]]; then
    if expect_header "location" "/login" "the admin gate redirects to sign-in"; then
      pass "/events/<id>/dashboard redirects to /login"
    fi
  else
    fail "$base_url/events/$event_id/dashboard" "the admin gate is live (expected a redirect, got $status)"
  fi
else
  skip "/events/<id>/dashboard" "set SMOKE_EVENT_ID to the seeded event id"
fi

# 6. The CFP page renders its deadline with a zone label. A date without the
#    label passes while showing a judge in another zone the wrong hour.
if [[ -n "$form_id" ]]; then
  if expect_status "$base_url/submit/$event_slug/$form_id" 200 "the CFP page renders"; then
    expect_body '[AP]M [A-Z]{2,4}' "the deadline carries a zone label" \
      && pass "/submit/$event_slug/<formId>"
  fi
else
  skip "/submit/<slug>/<formId>" "set SMOKE_FORM_ID to the seeded open form"
fi

# 7. M07's header contract, asserted here exactly as the module specifies it.
if [[ -n "$headshot_file_id" ]]; then
  if expect_status "$base_url/f/$headshot_file_id" 200 "the public file serves"; then
    expect_header "content-type" "image/" "the file serves its stored image type" \
      && expect_header "cache-control" "max-age=31536000" "the file is cached immutable" \
      && expect_header "cache-control" "immutable" "the file is cached immutable" \
      && expect_header "x-content-type-options" "nosniff" "the file is not sniffable" \
      && pass "/f/<seededHeadshotFileId>"
  fi
else
  skip "/f/<seededHeadshotFileId>" "set SMOKE_HEADSHOT_FILE_ID to a seeded headshot"
fi

# 8. www is not a second origin. Cookies are host-scoped and the OAuth
#    callback is registered on the apex, so a sign-in started on www strands
#    its state cookie there; every www path must permanently redirect to the
#    apex instead of serving.
if (( production )); then
  www_url="${base_url/#https:\/\//https://www.}"
  fetch "$www_url/login"
  apex_location="location: ${base_url}/login"
  if [[ "$last_status" == "308" || "$last_status" == "301" ]] && grep -qi "^${apex_location}" "$headers_file"; then
    pass "www redirects to the apex"
  else
    fail "$www_url/login" "www must permanently redirect to the apex /login (got $last_status)"
  fi
fi

# 9. The test-login route must not exist in production. It 404s unless
#    TEST_AUTH=1 at build time; this is what proves the production build lacks it.
if (( production )); then
  status="$(curl -sS -o "$body_file" -D "$headers_file" -w '%{http_code}' --max-time 30 -X POST \
    -H 'content-type: application/json' -d '{"email":"organizer@openboard.dev"}' \
    "$base_url/api/test/login" 2>/dev/null)" || status="000"
  if [[ "$status" == "404" ]]; then
    pass "/api/test/login is absent in production"
  else
    fail "$base_url/api/test/login" "the test-login route must 404 in production (got $status)"
  fi
fi

echo
if (( failures > 0 )); then
  echo "post-deploy smoke FAILED — $failures check(s) failed, $skips skipped"
  exit 1
fi
echo "post-deploy smoke passed — $skips check(s) skipped"
