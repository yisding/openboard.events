#!/usr/bin/env bash
set -euo pipefail

service="${1:?usage: deploy-cloudflare.sh web|jobs preview|production}"
target_env="${2:?usage: deploy-cloudflare.sh web|jobs preview|production}"

[[ "$service" == "web" || "$service" == "jobs" ]] || { echo "service must be web or jobs" >&2; exit 2; }
[[ "$target_env" == "preview" || "$target_env" == "production" ]] || { echo "environment must be preview or production" >&2; exit 2; }

if [[ "$service" == "jobs" ]]; then
  [[ "${ALLOW_MISSING_DEPLOY_SECRETS:-0}" != "1" ]] || {
    echo "ALLOW_MISSING_DEPLOY_SECRETS is only valid for the first web Worker bootstrap" >&2
    exit 2
  }
  pnpm deploy:preflight jobs "$target_env"
  exec wrangler deploy --config workers/jobs/wrangler.jsonc --env "$target_env"
fi

: "${APP_BASE_URL:?APP_BASE_URL must be the exact deployed web origin}"
[[ "$APP_BASE_URL" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] || { echo "APP_BASE_URL must be an https origin with no path or trailing slash" >&2; exit 2; }

case "$target_env" in
  preview) expected_app_base_url="https://sb-web-preview.yi-ding.workers.dev" ;;
  production) expected_app_base_url="https://openboard.events" ;;
esac
[[ "$APP_BASE_URL" == "$expected_app_base_url" ]] || {
  echo "APP_BASE_URL must be $expected_app_base_url for $target_env" >&2
  exit 2
}

if [[ "${ALLOW_MISSING_DEPLOY_SECRETS:-0}" == "1" ]]; then
  [[ "$service" == "web" ]] || {
    echo "ALLOW_MISSING_DEPLOY_SECRETS is only valid for the first web Worker bootstrap" >&2
    exit 2
  }
  pnpm exec tsx scripts/check-worker-bootstrap.ts "$target_env"
  echo "WARNING: skipping the remote secret inventory check for an explicit first-deploy bootstrap" >&2
else
  pnpm deploy:preflight "$service" "$target_env"
fi

: "${R2_ACCOUNT_ID:?R2_ACCOUNT_ID is required by the web runtime}"
if [[ "$target_env" == "production" ]]; then
  # EMAIL_FROM and EMAIL_REPLY_TO live in wrangler.jsonc's production vars: the former contains
  # <angle brackets>, and opennextjs-cloudflare spawns wrangler with shell:true
  # (args concatenated, not escaped), so passing it as --var is a shell syntax
  # error. Config JSON needs no quoting; just verify it is present.
  grep -q '"EMAIL_FROM"' wrangler.jsonc || { echo "EMAIL_FROM must be set in wrangler.jsonc production vars" >&2; exit 2; }
  grep -q '"EMAIL_REPLY_TO"' wrangler.jsonc || { echo "EMAIL_REPLY_TO must be set in wrangler.jsonc production vars" >&2; exit 2; }
fi

build_sha="${BUILD_SHA:-}"
if [[ -z "$build_sha" ]]; then
  build_sha=$(git rev-parse --short HEAD)
fi
export BUILD_SHA="$build_sha"
deployment_id="${DEPLOYMENT_ID:-manual-$(date -u +%Y%m%dT%H%M%SZ)-$$}"
export DEPLOYMENT_ID="$deployment_id"

vars=(
  --var "APP_BASE_URL:$APP_BASE_URL"
  --var "R2_ACCOUNT_ID:$R2_ACCOUNT_ID"
  --var "BUILD_SHA:$build_sha"
  --var "DEPLOYMENT_ID:$deployment_id"
)
[[ -n "${EMAIL_ALLOWLIST:-}" ]] && vars+=(--var "EMAIL_ALLOWLIST:$EMAIL_ALLOWLIST")
# AIRTABLE_CRON itself is a plain `vars` entry in wrangler.jsonc, not threaded
# through here — every real Airtable connection is per-event and sealed in
# the database, so there is no per-deploy base id to pass through anymore.

pnpm build:worker --env "$target_env"
# Re-run the supported-artifact contract against the exact environment before
# mutating the remote Worker. CI measures production, while this also records
# preview/production-specific compatibility flags in the deployment summary.
WORKER_SIZE_ENV="$target_env" pnpm worker:size
# OpenNext's deploy helper also initializes a local platform proxy and would
# otherwise load ignored developer env files while populating cache assets.
# Keep the same isolation boundary used by the reproducible build.
bash scripts/build-worker-clean.sh --command \
  pnpm exec opennextjs-cloudflare deploy --env "$target_env" "${vars[@]}"
