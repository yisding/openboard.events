#!/usr/bin/env bash
set -euo pipefail

service="${1:?usage: deploy-cloudflare.sh web|jobs preview|production}"
target_env="${2:?usage: deploy-cloudflare.sh web|jobs preview|production}"

[[ "$service" == "web" || "$service" == "jobs" ]] || { echo "service must be web or jobs" >&2; exit 2; }
[[ "$target_env" == "preview" || "$target_env" == "production" ]] || { echo "environment must be preview or production" >&2; exit 2; }
: "${APP_BASE_URL:?APP_BASE_URL must be the exact deployed web origin}"
[[ "$APP_BASE_URL" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] || { echo "APP_BASE_URL must be an https origin with no path or trailing slash" >&2; exit 2; }

if [[ "$service" == "jobs" ]]; then
  exec wrangler deploy --config workers/jobs/wrangler.jsonc --env "$target_env" --var "APP_BASE_URL:$APP_BASE_URL"
fi

: "${R2_ACCOUNT_ID:?R2_ACCOUNT_ID is required by the web runtime}"
if [[ "$target_env" == "production" ]]; then
  : "${EMAIL_FROM:?EMAIL_FROM is required for production}"
fi

build_sha="${NEXT_PUBLIC_BUILD_SHA:-}"
if [[ -z "$build_sha" ]]; then
  build_sha=$(git rev-parse --short HEAD)
fi
export NEXT_PUBLIC_BUILD_SHA="$build_sha"

vars=(
  --var "APP_BASE_URL:$APP_BASE_URL"
  --var "R2_ACCOUNT_ID:$R2_ACCOUNT_ID"
  --var "NEXT_PUBLIC_BUILD_SHA:$build_sha"
)
[[ -n "${EMAIL_FROM:-}" ]] && vars+=(--var "EMAIL_FROM:$EMAIL_FROM")
[[ -n "${EMAIL_ALLOWLIST:-}" ]] && vars+=(--var "EMAIL_ALLOWLIST:$EMAIL_ALLOWLIST")
[[ -n "${AIRTABLE_BASE_ID:-}" ]] && vars+=(--var "AIRTABLE_BASE_ID:$AIRTABLE_BASE_ID")

opennextjs-cloudflare build --env "$target_env"
exec opennextjs-cloudflare deploy --env "$target_env" "${vars[@]}"
