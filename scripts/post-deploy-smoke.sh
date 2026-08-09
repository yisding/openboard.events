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

# Seeded artifacts. Protected deployment environments provide the ids; --strict
# makes a missing fixture a failed deployment rather than a silent reduction in
# coverage. The deterministic M09 public-event slug is safe to default here.
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
    && pass "/api/health"
fi

# 2. The public schedule is cached at the edge. Two things this deliberately does
#    not assert: the literal s-maxage=60 (OpenNext counts it down as the entry
#    ages, so a page rendered 58 seconds ago honestly answers s-maxage=2), and
#    the header's presence on the first request. A cold entry — right after a
#    deploy, or after a revalidation — is served STALE with no Cache-Control at
#    all until the cache settles, which is a legitimate transient rather than a
#    broken contract. So it is retried, and only a page that never becomes
#    cacheable fails.
schedule_ok=0
for attempt in 1 2 3 4 5; do
  # Retryable probes use fetch directly: expect_status records a permanent
  # failure, which would make a transient 503 fail the whole run even when a
  # later attempt succeeds.
  fetch "$base_url/e/$event_slug/schedule"
  if [[ "$last_status" == "200" ]]; then
    if [[ "$(header_value cache-control)" == *"s-maxage="* ]]; then schedule_ok=1; break; fi
  fi
  if (( attempt < 5 )); then sleep 2; fi
done
if (( schedule_ok )); then
  pass "/e/$event_slug/schedule"
elif [[ "$last_status" != "200" ]]; then
  fail "$base_url/e/$event_slug/schedule" "public schedule renders (expected 200 after 5 attempts, got $last_status)"
else
  fail "$base_url/e/$event_slug/schedule" "public schedule is edge-cached (no s-maxage after 5 attempts)"
fi

# 3. The embed variant must be framable: CSP allows any ancestor and the legacy
#    header is absent. Both together is the classic blank-iframe failure.
if expect_status "$base_url/embed/$event_slug/schedule" 200 "embed renders"; then
  expect_header "content-security-policy" "frame-ancestors *" "embed allows framing" \
    && expect_no_header "x-frame-options" "embed does not send X-Frame-Options" \
    && pass "/embed/$event_slug/schedule"
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

# 8. The test-login route must not exist in production. It 404s unless
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
