#!/usr/bin/env bash
#
# Boots the already-built OpenNext artifact under local workerd and exercises
# several independent server entries. This catches artifact/runtime failures
# that `next build`, Vitest, and Wrangler's bundle-size dry run cannot detect.
# In particular, it would have caught the missing named webpack chunk that once
# made every deployed route throw `Unknown chunk <id>` while all static gates
# remained green.
#
# The probe is credential-free and never uses remote bindings. An explicit env
# file keeps a developer's .dev.vars out of the Worker, and local R2 state plus
# logs live under ~/Code rather than /tmp.
set -euo pipefail

[[ -f .open-next/worker.js ]] || {
  echo "worker artifact is missing; run pnpm build:worker first" >&2
  exit 2
}

command -v curl >/dev/null 2>&1 || {
  echo "worker artifact smoke requires curl" >&2
  exit 2
}

port="${WORKER_SMOKE_PORT:-18789}"
if [[ ! "$port" =~ ^[0-9]+$ ]] || (( port < 1024 || port > 65535 )); then
  echo "WORKER_SMOKE_PORT must be an integer from 1024 through 65535" >&2
  exit 2
fi

scratch_root="${WORKER_SMOKE_TMP_ROOT:-${HOME:?HOME is required}/Code}"
mkdir -p "$scratch_root"
scratch_dir="$(mktemp -d "$scratch_root/openboard-worker-smoke.XXXXXX")"
log_file="$scratch_dir/workerd.log"
env_file="$scratch_dir/smoke.env"
state_dir="$scratch_dir/state"
worker_pid=""

cleanup() {
  if [[ -n "$worker_pid" ]] && kill -0 "$worker_pid" 2>/dev/null; then
    kill "$worker_pid" 2>/dev/null || true
    wait "$worker_pid" 2>/dev/null || true
  fi
  rm -rf "$scratch_dir"
}
trap cleanup EXIT INT TERM

cat > "$env_file" <<EOF
APP_ENV=local
APP_BASE_URL=http://127.0.0.1:$port
EMAIL_MODE=log
EMAIL_FALLBACK_UI=1
AIRTABLE_CRON=0
R2_BUCKET_NAME=sb-files-dev
EOF

pnpm exec wrangler dev \
  --config wrangler.jsonc \
  --local \
  --ip 127.0.0.1 \
  --port "$port" \
  --local-protocol http \
  --persist-to "$state_dir" \
  --env-file "$env_file" \
  --show-interactive-dev-session=false \
  >"$log_file" 2>&1 &
worker_pid=$!

base_url="http://127.0.0.1:$port"
ready=0
for _attempt in $(seq 1 60); do
  if ! kill -0 "$worker_pid" 2>/dev/null; then
    echo "workerd exited before it became ready" >&2
    tail -80 "$log_file" >&2
    exit 1
  fi
  if curl --silent --output /dev/null --max-time 2 "$base_url/" 2>/dev/null; then
    ready=1
    break
  fi
  sleep 0.5
done

if (( ready == 0 )); then
  echo "workerd did not become ready within 30 seconds" >&2
  tail -80 "$log_file" >&2
  exit 1
fi

probe() {
  local path="$1"
  local expected="$2"
  local status
  status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --max-time 15 "$base_url$path")" || status="000"
  if [[ ! "$status" =~ ^($expected)$ ]]; then
    echo "worker artifact smoke failed: GET $path returned $status; expected $expected" >&2
    tail -80 "$log_file" >&2
    exit 1
  fi
  echo "ok    GET $path -> $status"
}

# These routes span the root page, two separate auth page entries, middleware,
# and an API route. Health intentionally returns 503 because this isolated
# smoke supplies no database; reaching that application response proves the
# route module loaded. Runtime-integrity failures are rejected from the log
# below even if Next turns one into an otherwise ambiguous HTTP 500.
probe "/" "200"
probe "/login" "200"
probe "/signup" "200"
probe "/events" "200|302|307"
probe "/api/health" "503"

sleep 1
if grep -Ein \
  'Unknown chunk|Cannot find module|No such module|failed to load chunk|module not found' \
  "$log_file"; then
  echo "worker artifact smoke found a module/chunk integrity failure" >&2
  exit 1
fi

echo "worker artifact smoke passed under local workerd"
