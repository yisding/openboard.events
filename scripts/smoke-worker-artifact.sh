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
r2_log_file="$scratch_dir/r2-seed.log"
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
SESSION_SECRET=worker-smoke-session-secret-at-least-32-bytes
AIRTABLE_CRON=0
NEXT_INC_CACHE_R2_PREFIX=open-next-cache
NEXT_PRIVATE_DEBUG_CACHE=1
R2_BUCKET_NAME=sb-files-dev
EOF

# Seed one prerender entry into the exact local R2 state the application Worker
# will use. `populateCache local` starts a separate ephemeral Worker, so it does
# not prove that this artifact can read its configured R2 binding. Writing the
# same content-addressed key as OpenNext lets the request below exercise the
# production R2IncrementalCache implementation without remote credentials.
cache_file="$(find .open-next/cache -type f -path '*/kitchen-sink/rich.cache' -print -quit)"
if [[ -z "$cache_file" ]]; then
  echo "worker artifact smoke requires the /kitchen-sink/rich prerender cache entry" >&2
  exit 2
fi
build_id="$(basename "$(dirname "$(dirname "$cache_file")")")"
cache_hash="$(node --input-type=module -e '
  import { createHash } from "node:crypto";
  process.stdout.write(createHash("sha256").update("/kitchen-sink/rich").digest("hex"));
')"
cache_object="sb-files-dev/open-next-cache/$build_id/$cache_hash.cache"
pnpm exec wrangler r2 object put "$cache_object" \
  --config wrangler.jsonc \
  --local \
  --persist-to "$state_dir" \
  --file "$cache_file" \
  --force \
  >"$r2_log_file" 2>&1

# RichTextEditor is client-only and dynamically imported. Locate its emitted
# ProseMirror-bearing chunk from the built artifact so this check remains tied
# to module content rather than an unstable webpack id.
lazy_chunk="$(grep -El -m1 'ProseMirror|prosemirror' .open-next/assets/_next/static/chunks/*.js 2>/dev/null | head -1 || true)"
if [[ -z "$lazy_chunk" ]]; then
  echo "worker artifact smoke could not find the lazy rich-text editor chunk" >&2
  exit 2
fi
lazy_chunk_path="/${lazy_chunk#.open-next/assets/}"

started_at_ms="$(node -p 'Date.now()')"
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
first_dynamic_ttfb=""
for attempt in $(seq 1 60); do
  if ! kill -0 "$worker_pid" 2>/dev/null; then
    echo "workerd exited before it became ready" >&2
    tail -80 "$log_file" >&2
    exit 1
  fi
  readiness="$(curl --silent --output /dev/null --write-out '%{http_code}\t%{time_starttransfer}' --max-time 2 "$base_url/" 2>/dev/null || true)"
  if [[ "${readiness%%$'\t'*}" == "200" ]]; then
    ready=1
    first_dynamic_ttfb="${readiness#*$'\t'}"
    ready_attempts="$attempt"
    break
  fi
  sleep 0.5
done

if (( ready == 0 )); then
  echo "workerd did not become ready within 30 seconds" >&2
  tail -80 "$log_file" >&2
  exit 1
fi
cold_start_ms=$(( $(node -p 'Date.now()') - started_at_ms ))

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

probe_redirect() {
  local path="$1"
  local expected_location="$2"
  local response
  local status
  local redirect_url
  response="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}\t%{redirect_url}' --max-time 15 "$base_url$path")" || response="000\t"
  status="${response%%$'\t'*}"
  redirect_url="${response#*$'\t'}"
  if [[ "$status" != "307" || "$redirect_url" != "$base_url$expected_location" ]]; then
    echo "worker artifact smoke failed: GET $path returned $status -> $redirect_url; expected 307 -> $base_url$expected_location" >&2
    tail -80 "$log_file" >&2
    exit 1
  fi
  echo "ok    GET $path -> $status -> $expected_location"
}

probe_cache_hit() {
  local path="$1"
  local headers="$scratch_dir/cache-headers"
  local body="$scratch_dir/cache-body"
  local status
  status="$(curl --silent --show-error --dump-header "$headers" --output "$body" --write-out '%{http_code}' --max-time 15 "$base_url$path")" || status="000"
  if [[ "$status" != "200" ]]; then
    echo "worker artifact smoke failed: GET $path returned $status; expected 200" >&2
    tail -80 "$log_file" >&2
    exit 1
  fi
  if ! grep -Eiq '^x-nextjs-cache:[[:space:]]*HIT' "$headers"; then
    echo "worker artifact smoke failed: GET $path did not report an R2 cache HIT" >&2
    cat "$headers" >&2
    tail -80 "$log_file" >&2
    exit 1
  fi
  if ! grep -Fq 'Rich primitives' "$body"; then
    echo "worker artifact smoke failed: cached GET $path returned the wrong body" >&2
    exit 1
  fi
  echo "ok    GET $path -> 200 (R2 cache HIT)"
}

probe_private_job_denial() {
  local path="$1"
  local status
  status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --max-time 15 \
    --request POST --header 'x-openboard-private-job: JobsEntrypoint' "$base_url$path")" || status="000"
  if [[ "$status" != "404" ]]; then
    echo "worker artifact smoke failed: public POST $path returned $status; expected 404" >&2
    tail -80 "$log_file" >&2
    exit 1
  fi
  echo "ok    public POST $path -> 404"
}

# These routes span a dynamic server component, static prerender served from
# R2, two separate auth page entries, middleware, an auth API route, a regular
# API route, and a lazy client chunk. Health intentionally returns 503 because
# this isolated smoke supplies no database; reaching that application response
# proves the route module loaded. Runtime-integrity failures are rejected from
# the log below even if Next turns one into an otherwise ambiguous HTTP 500.
probe "/" "200"
probe_cache_hit "/kitchen-sink/rich"
probe "/login" "200"

# The canonical-host redirect in next.config.ts must survive the OpenNext
# transform, and only a workerd probe can prove that: a `has: host` redirect
# that the adapter mishandles is invisible to every static gate. 4fe419a's
# chunk regression taught the same lesson about this artifact.
www_response="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}\t%{redirect_url}' --max-time 15 -H 'Host: www.openboard.events' "$base_url/login")" || www_response=$'000\t'
www_status="${www_response%%$'\t'*}"
www_redirect_url="${www_response#*$'\t'}"
if [[ "$www_status" != "308" || "$www_redirect_url" != "https://openboard.events/login" ]]; then
  echo "worker artifact smoke failed: www host GET /login returned $www_status -> $www_redirect_url; expected 308 -> https://openboard.events/login" >&2
  tail -80 "$log_file" >&2
  exit 1
fi
echo "ok    GET /login (Host: www.openboard.events) -> 308 -> https://openboard.events/login"
# Better Auth is the only provider, so signup must remain available in every
# environment. `/events` is an authenticated surface in every environment (the
# credential-free local demo that once rendered it signed-out is gone), so the
# probe below allows both the sign-in redirect and whatever this database-less
# artifact renders.
probe "/signup" "200"
probe "/events" "200|302|307"
probe "/api/auth/get-session" "200"
probe "/api/health" "503"
probe_private_job_denial "/worker-jobs/outbox"
probe "$lazy_chunk_path" "200"

sleep 1
if grep -Ein \
  'Unknown chunk|Cannot find module|No such module|failed to load chunk|module not found' \
  "$log_file"; then
  echo "worker artifact smoke found a module/chunk integrity failure" >&2
  exit 1
fi

echo "Worker cold-start metrics: ready_ms=$cold_start_ms first_dynamic_ttfb_s=$first_dynamic_ttfb attempts=$ready_attempts failures=0"
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    echo "### Local workerd cold start"
    echo
    echo "| ready ms | first dynamic TTFB s | attempts | failures |"
    echo "| ---: | ---: | ---: | ---: |"
    echo "| $cold_start_ms | $first_dynamic_ttfb | $ready_attempts | 0 |"
  } >> "$GITHUB_STEP_SUMMARY"
fi
echo "worker artifact smoke passed under local workerd"
