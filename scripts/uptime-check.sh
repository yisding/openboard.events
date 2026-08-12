#!/usr/bin/env bash
#
# M48 — the check `.github/workflows/uptime.yml` runs on a schedule against the
# already-deployed preview and production origins. Curl-based and read-only: it
# never builds, migrates, or deploys anything, so it is safe to run far more
# often than the Deploy workflow and safe to run by hand at any time:
#
#   bash scripts/uptime-check.sh https://sb-web-preview.yi-ding.workers.dev
#   bash scripts/uptime-check.sh https://sb-web.yi-ding.workers.dev
#
# Thresholds mirror docs/runbooks/alerting.md's `/api/health` table exactly —
# update both together, in the same change, if either changes. Two exit tiers:
#   - `page` breaches (unreachable, non-200, ok=false, db.ok=false, any caught
#     unexpected error in the last hour, or a comms metric past its page
#     threshold) print `::error::` and exit 1, failing the
#     workflow run — a failed scheduled run is itself today's alert (see
#     alerting.md's header for why no separate paging integration exists yet).
#   - `warn` breaches (comms.ok=false on its own, or a comms metric past its
#     warn-but-not-page threshold) print `::warning::` and exit 0 — visible in
#     the run's annotations without failing it, matching alerting.md's
#     "don't page on the first sign of this" guidance for those fields.
set -uo pipefail

base_url="${1:?usage: uptime-check.sh URL}"
base_url="${base_url%/}"

command -v jq >/dev/null 2>&1 || { echo "uptime-check: jq is required" >&2; exit 2; }
command -v curl >/dev/null 2>&1 || { echo "uptime-check: curl is required" >&2; exit 2; }

# Keep these four numbers identical to the "Warn" / "Page" columns in
# docs/runbooks/alerting.md's `/api/health` thresholds table.
WARN_QUEUED=100
PAGE_QUEUED=300
WARN_FAILED=10
PAGE_FAILED=50
WARN_OLDEST_SECONDS=900
PAGE_OLDEST_SECONDS=3600

fail=0
warn=0

echo "uptime check: GET $base_url/api/health"

response_file="$(mktemp)"
trap 'rm -f "$response_file"' EXIT

if ! status="$(curl -sS -o "$response_file" -w '%{http_code}' --max-time 15 "$base_url/api/health" 2>/dev/null)"; then
  status="000"
fi

if [[ "$status" != "200" ]]; then
  echo "::error::health endpoint returned HTTP $status (expected 200) for $base_url/api/health"
  cat "$response_file" >&2
  exit 1
fi

body="$(cat "$response_file")"

if ! jq -e . >/dev/null 2>&1 <<<"$body"; then
  echo "::error::health endpoint did not return valid JSON"
  echo "$body" >&2
  exit 1
fi

ok="$(jq -r '.ok' <<<"$body")"
db_ok="$(jq -r '.db.ok' <<<"$body")"

if [[ "$ok" != "true" ]]; then
  echo "::error::health reports ok=false for $base_url"
  fail=1
fi
if [[ "$db_ok" != "true" ]]; then
  echo "::error::health reports db.ok=false for $base_url — Neon is unreachable or misconfigured"
  fail=1
fi

if [[ "$fail" -ne 0 ]]; then
  echo "$body" | jq . >&2
  exit 1
fi

# This field is additive. A missing field warns during the one-deploy rollout
# window; once present, an unavailable aggregate query or any caught unexpected
# error in the last hour is an incident. The protected post-deploy smoke pins
# the new schema so a deployment cannot claim success without the field.
errors_present="$(jq -r 'has("errors")' <<<"$body")"
if [[ "$errors_present" != "true" ]]; then
  echo "::warning::health has no errors aggregate for $base_url — deploy the current health schema"
  warn=1
else
  errors_ok="$(jq -r '.errors.ok // false' <<<"$body")"
  recent_errors="$(jq -r '.errors.recentCount // empty' <<<"$body")"
  error_window="$(jq -r '.errors.windowSeconds // empty' <<<"$body")"
  if [[ "$errors_ok" != "true" ]]; then
    echo "::error::health reports errors.ok=false for $base_url — automated unexpected-error tracking is unavailable"
    fail=1
  elif [[ ! "$recent_errors" =~ ^[0-9]+$ || "$error_window" != "3600" ]]; then
    echo "::error::health returned an invalid errors aggregate for $base_url"
    fail=1
  elif (( recent_errors > 0 )); then
    echo "::error::errors.recentCount=$recent_errors in the last hour for $base_url — inspect structured error.captured logs"
    fail=1
  fi
fi

comms_ok="$(jq -r '.comms.ok // false' <<<"$body")"
if [[ "$comms_ok" != "true" ]]; then
  echo "::warning::health reports comms.ok=false for $base_url — $(jq -r '.comms.error // "no error detail"' <<<"$body")"
  warn=1
fi

queued="$(jq -r '.comms.queuedCount // empty' <<<"$body")"
failed="$(jq -r '.comms.failedCount // empty' <<<"$body")"
oldest="$(jq -r '.comms.oldestQueuedAgeSeconds // empty' <<<"$body")"

if [[ "$queued" =~ ^[0-9]+$ ]]; then
  if (( queued > PAGE_QUEUED )); then
    echo "::error::comms.queuedCount=$queued exceeds page threshold ($PAGE_QUEUED) for $base_url"
    fail=1
  elif (( queued > WARN_QUEUED )); then
    echo "::warning::comms.queuedCount=$queued exceeds warn threshold ($WARN_QUEUED) for $base_url"
    warn=1
  fi
fi

if [[ "$failed" =~ ^[0-9]+$ ]]; then
  if (( failed > PAGE_FAILED )); then
    echo "::error::comms.failedCount=$failed exceeds page threshold ($PAGE_FAILED) for $base_url"
    fail=1
  elif (( failed > WARN_FAILED )); then
    echo "::warning::comms.failedCount=$failed exceeds warn threshold ($WARN_FAILED) for $base_url"
    warn=1
  fi
fi

if [[ "$oldest" =~ ^[0-9]+$ ]]; then
  if (( oldest > PAGE_OLDEST_SECONDS )); then
    echo "::error::comms.oldestQueuedAgeSeconds=$oldest exceeds page threshold ($PAGE_OLDEST_SECONDS) for $base_url"
    fail=1
  elif (( oldest > WARN_OLDEST_SECONDS )); then
    echo "::warning::comms.oldestQueuedAgeSeconds=$oldest exceeds warn threshold ($WARN_OLDEST_SECONDS) for $base_url"
    warn=1
  fi
fi

echo "$body" | jq .

if [[ "$fail" -ne 0 ]]; then
  echo "uptime check FAILED for $base_url"
  exit 1
fi
if [[ "$warn" -ne 0 ]]; then
  echo "uptime check passed with warnings for $base_url"
  exit 0
fi
echo "uptime check OK for $base_url"
exit 0
