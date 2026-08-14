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
health_headers_file="$(mktemp)"
health_body_file="$(mktemp)"
schedule_headers_file="$(mktemp)"
schedule_body_file="$(mktemp)"
embed_headers_file="$(mktemp)"
embed_body_file="$(mktemp)"
trap 'rm -f "$headers_file" "$body_file" "$health_headers_file" "$health_body_file" "$schedule_headers_file" "$schedule_body_file" "$embed_headers_file" "$embed_body_file"' EXIT
deployed_build_sha=""
deployed_id="${DEPLOYMENT_ID:-}"
# Cloudflare can briefly route requests to the previous Worker after wrangler
# reports success, and OpenNext's shared R2 entries may need more than one ISR
# window to converge. A shared four-minute deadline covers the propagation
# observed in preview without multiplying the wait across health, agenda, and
# embed. Each propagation request is capped by the time left; after expiry,
# each unresolved surface gets at most a one-second diagnostic request. The
# exact deployment marker remains the acceptance condition, so waiting longer
# cannot turn an old cache entry into a false positive.
propagation_timeout_seconds="${SMOKE_PROPAGATION_TIMEOUT_SECONDS:-240}"
propagation_interval_seconds=5
if [[ ! "$propagation_timeout_seconds" =~ ^[1-9][0-9]*$ ]]; then
  echo "SMOKE_PROPAGATION_TIMEOUT_SECONDS must be a positive integer" >&2
  exit 2
fi
propagation_deadline=$((SECONDS + propagation_timeout_seconds))

# Fetches once into $headers_file/$body_file and stores the status code, so no
# assertion costs a second request. Calling this function directly preserves
# last_url; command substitution would run it in a subshell and discard that
# diagnostic state before a later header/body assertion failed.
last_url=""
last_status=""
fetch() {
  last_url="$1"
  local timeout_seconds="${2:-30}"
  last_status="$(curl -sS -o "$body_file" -D "$headers_file" -w '%{http_code}' --max-time "$timeout_seconds" "$1" 2>/dev/null)" \
    || last_status="000"
}

# Uses no more than the shared time remaining. A one-second request after the
# deadline preserves a concrete status/header diagnostic for every unresolved
# surface without starting another retry window.
propagation_fetch() {
  local remaining
  remaining=$((propagation_deadline - SECONDS))
  if (( remaining <= 0 )); then
    remaining=1
  elif (( remaining > 30 )); then
    remaining=30
  fi
  fetch "$1" "$remaining"
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

# Sleeps only inside the shared propagation budget. Returning false ends the
# interleaved retry loop after every unresolved surface has captured its latest
# status, headers, and body for a concrete failure diagnostic.
wait_for_propagation_retry() {
  local remaining delay
  remaining=$((propagation_deadline - SECONDS))
  (( remaining > 0 )) || return 1
  delay="$propagation_interval_seconds"
  if (( remaining < delay )); then delay="$remaining"; fi
  sleep "$delay"
  # Always allow the post-sleep cycle. If sleep reached the deadline,
  # propagation_fetch caps each unresolved surface to its one-second final
  # diagnostic request; the next call here then stops without another sleep.
  return 0
}

# A header value, lowercased, with the name stripped. Empty when absent.
header_value() {
  tr -d '\r' < "$headers_file" | grep -i "^$1:" | head -1 | cut -d: -f2- | sed 's/^ *//' | tr '[:upper:]' '[:lower:]'
}

# OpenNext exposes two conclusive forms of the same healthy edge-cache
# contract. A fresh render carries s-maxage for the cache to store. Once that
# entry is served by the incremental cache, OpenNext can omit Cache-Control
# and report HIT in x-nextjs-cache instead. STALE is deliberately not enough:
# it proves that an old entry exists, but not that this artifact can regenerate
# it successfully.
is_edge_cache_fresh() {
  local cache_control next_cache
  cache_control="$(header_value cache-control)"
  next_cache="$(header_value x-nextjs-cache)"
  [[ "$cache_control" == *"s-maxage="* || "$next_cache" == "hit" ]]
}

# The cache signal alone can describe an unexpired entry written by the
# previous Worker — even one built from the same commit. This per-deployment
# marker is part of the cached document itself, so a matching value proves this
# exact Worker deployment completed the render.
is_current_deployment() {
  [[ -n "$deployed_id" ]] \
    && grep -qF -- "data-openboard-deployment=\"$deployed_id\"" "$body_file"
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

expect_body_literal() {
  local value="$1" what="$2"
  if ! grep -qF -- "$value" "$body_file"; then
    fail "" "$what (body does not contain '$value')"
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

# 1–3. Cloudflare can briefly route each URL to the previous Worker
# independently, while the direct and embedded agendas also have separate ISR
# entries. Probe all three in every cycle so no surface consumes another's
# propagation budget. Health supplies the deployment id for manual runs;
# protected deploys provide it up front so cached HTML can be accepted as soon
# as its exact marker arrives.
health_ok=0
health_attempts=0
health_last_status=""
schedule_ok=0
schedule_attempts=0
schedule_last_status=""
embed_ok=0
embed_contract_ok=0
embed_attempts=0
embed_last_status=""
while (( ! health_ok || ! schedule_ok || ! embed_ok )); do
  learned_deployment_id=0
  if (( ! schedule_ok )); then
    schedule_attempts=$((schedule_attempts + 1))
    propagation_fetch "$base_url/e/$event_slug/agenda"
    schedule_last_status="$last_status"
    cp "$headers_file" "$schedule_headers_file"
    cp "$body_file" "$schedule_body_file"
    if [[ "$last_status" == "200" ]] && is_edge_cache_fresh && is_current_deployment; then
      schedule_ok=1
    fi
  fi

  if (( ! embed_ok )); then
    embed_attempts=$((embed_attempts + 1))
    propagation_fetch "$base_url/embed/$event_slug/agenda"
    embed_last_status="$last_status"
    cp "$headers_file" "$embed_headers_file"
    cp "$body_file" "$embed_body_file"
    if [[ "$last_status" == "200" ]] && is_edge_cache_fresh && is_current_deployment; then
      embed_ok=1
      if expect_header "content-security-policy" "frame-ancestors *" "embed allows framing" \
        && expect_no_header "x-frame-options" "embed does not send X-Frame-Options"; then
        embed_contract_ok=1
      fi
    fi
  fi

  if (( ! health_ok )); then
    health_attempts=$((health_attempts + 1))
    propagation_fetch "$base_url/api/health"
    health_last_status="$last_status"
    cp "$headers_file" "$health_headers_file"
    cp "$body_file" "$health_body_file"
    candidate_build_sha="$(sed -n 's/.*\"sha\":\"\([^\"]*\)\".*/\1/p' "$body_file" | head -1)"
    candidate_deployment_id="$(sed -n 's/.*\"deployment\":\"\([^\"]*\)\".*/\1/p' "$body_file" | head -1)"
    if [[ "$last_status" == "200" && -n "$candidate_build_sha" && -n "$candidate_deployment_id" ]] \
      && { [[ -z "${NEXT_PUBLIC_BUILD_SHA:-}" ]] || [[ "$candidate_build_sha" == "$NEXT_PUBLIC_BUILD_SHA" ]]; } \
      && { [[ -z "${DEPLOYMENT_ID:-}" ]] || [[ "$candidate_deployment_id" == "$DEPLOYMENT_ID" ]]; }; then
      health_ok=1
      deployed_build_sha="$candidate_build_sha"
      if [[ -z "$deployed_id" ]]; then learned_deployment_id=1; fi
      deployed_id="$candidate_deployment_id"
    fi
  fi

  # A standalone invocation has no expected DEPLOYMENT_ID, so the cache probes
  # above cannot be judged until health supplies it later in this first
  # successful cycle. Re-evaluate the retained responses immediately instead
  # of requiring another cycle that may fall beyond the shared deadline.
  if (( learned_deployment_id && ! schedule_ok )); then
    cp "$schedule_headers_file" "$headers_file"
    cp "$schedule_body_file" "$body_file"
    if [[ "$schedule_last_status" == "200" ]] && is_edge_cache_fresh && is_current_deployment; then
      schedule_ok=1
    fi
  fi
  if (( learned_deployment_id && ! embed_ok )); then
    cp "$embed_headers_file" "$headers_file"
    cp "$embed_body_file" "$body_file"
    if [[ "$embed_last_status" == "200" ]] && is_edge_cache_fresh && is_current_deployment; then
      embed_ok=1
      if expect_header "content-security-policy" "frame-ancestors *" "embed allows framing" \
        && expect_no_header "x-frame-options" "embed does not send X-Frame-Options"; then
        embed_contract_ok=1
      fi
    fi
  fi

  (( health_ok && schedule_ok && embed_ok )) && break
  wait_for_propagation_retry || break
done

cp "$health_headers_file" "$headers_file"
cp "$health_body_file" "$body_file"
if (( ! health_ok )); then
  if [[ "$health_last_status" != "200" ]]; then
    fail "$base_url/api/health" "health responds (expected 200 before the propagation deadline; got $health_last_status after $health_attempts attempts)"
  elif [[ -z "$(sed -n 's/.*\"sha\":\"\([^\"]*\)\".*/\1/p' "$body_file" | head -1)" ]]; then
    fail "$base_url/api/health" "health identifies the deployed build before the propagation deadline ($health_attempts attempts)"
  elif [[ -z "$(sed -n 's/.*\"deployment\":\"\([^\"]*\)\".*/\1/p' "$body_file" | head -1)" ]]; then
    fail "$base_url/api/health" "health identifies the unique deployment before the propagation deadline ($health_attempts attempts)"
  elif [[ -n "${NEXT_PUBLIC_BUILD_SHA:-}" ]] \
    && ! grep -qF -- "\"sha\":\"$NEXT_PUBLIC_BUILD_SHA\"" "$body_file"; then
    fail "$base_url/api/health" "health matches the requested build before the propagation deadline ($health_attempts attempts)"
  else
    fail "$base_url/api/health" "health matches the requested deployment before the propagation deadline ($health_attempts attempts)"
  fi
else
  if expect_body '"ok":true' "health reports ok" \
    && expect_body 'ms' "health reports a database timing" \
    && expect_body '"errors":\{"ok":true' "health reports operational error tracking" \
    && expect_body '"jobs":\{"ok":true' "health reports scheduled-job heartbeat tracking"; then
    if [[ -z "$deployed_build_sha" ]]; then
      fail "$base_url/api/health" "health identifies the deployed build"
    elif [[ -z "$deployed_id" ]]; then
      fail "$base_url/api/health" "health identifies the unique deployment"
    elif [[ -n "${NEXT_PUBLIC_BUILD_SHA:-}" ]] \
      && ! expect_body_literal "\"sha\":\"$NEXT_PUBLIC_BUILD_SHA\"" "health matches the requested build"; then
      :
    elif [[ -n "${DEPLOYMENT_ID:-}" ]] \
      && ! expect_body_literal "\"deployment\":\"$DEPLOYMENT_ID\"" "health matches the requested deployment"; then
      :
    else
      pass "/api/health"
    fi
  fi
fi

# 1b. Better Auth's non-mutating session endpoint must be mounted. This catches
# a deployment that renders `/signup` but cannot accept the form before a smoke
# test creates any customer data.
if expect_status "$base_url/api/auth/get-session" 200 "self-service auth is mounted"; then
  pass "/api/auth/get-session"
fi

# 2. The public schedule and embed use separate ISR cache entries, so probe them
#    together inside the shared propagation window. This both initiates their
#    regeneration before waiting and prevents whichever is checked first from
#    consuming the other's retry budget. Two things this deliberately does
#    not assert: the literal s-maxage=60 (OpenNext counts it down as the entry
#    ages, so a page rendered 58 seconds ago honestly answers s-maxage=2), and
#    Cache-Control's presence on a cached response. OpenNext can serve an ISR
#    entry as HIT with no Cache-Control at all; x-nextjs-cache is the
#    authoritative signal in that case. STALE stays retryable because it can
#    also mean regeneration is failing.
#    The embed variant must also be framable: CSP allows any ancestor and the
#    legacy header is absent. Both together is the classic blank-iframe failure.
#    All retry state was collected by the interleaved loop above.

if (( schedule_ok )); then
  pass "/e/$event_slug/agenda"
else
  cp "$schedule_headers_file" "$headers_file"
  if [[ "$schedule_last_status" != "200" ]]; then
    fail "$base_url/e/$event_slug/agenda" "public agenda renders (expected 200 before the propagation deadline; got $schedule_last_status after $schedule_attempts attempts)"
  else
    fail "$base_url/e/$event_slug/agenda" "public agenda has a fresh cache entry from deployment $deployed_id before the propagation deadline ($schedule_attempts attempts)"
  fi
fi

if (( embed_ok )); then
  if (( embed_contract_ok )); then pass "/embed/$event_slug/agenda"; fi
else
  cp "$embed_headers_file" "$headers_file"
  if [[ "$embed_last_status" != "200" ]]; then
    fail "$base_url/embed/$event_slug/agenda" "embed renders (expected 200 before the propagation deadline; got $embed_last_status after $embed_attempts attempts)"
  else
    fail "$base_url/embed/$event_slug/agenda" "embed has a fresh cache entry from deployment $deployed_id before the propagation deadline ($embed_attempts attempts)"
  fi
fi

# 2b. M53 renamed the canonical surface to /agenda; the legacy /schedule URL
# must keep answering with a redirect so old links and embeds never break.
if expect_status "$base_url/e/$event_slug/schedule" 307 "legacy /schedule redirects to the M53 surface"; then
  pass "/e/$event_slug/schedule (307 legacy redirect)"
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

# 9. The retired test-login route must not exist in production.
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
