#!/usr/bin/env bash
set -euo pipefail

run_tests() {
  pnpm exec vitest run "$@"
}

# An explicit engine request is checked first so it still wins when a
# TEST_POSTGRES_URL happens to be exported in the surrounding shell.
if [[ "${OPENBOARD_TEST_ENGINE:-}" == "pglite" ]]; then
  run_tests "$@"
  exit $?
fi

if [[ -n "${TEST_POSTGRES_URL:-}" ]]; then
  run_tests "$@"
  exit $?
fi

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  echo "Docker is unavailable; using the slower PGlite test engine. Set OPENBOARD_TEST_ENGINE=pglite to silence this notice." >&2
  run_tests "$@"
  exit $?
fi

test_container="openboard-tests-${PPID}-${RANDOM}"
postgres_image="postgres@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193"

cleanup_test_postgres() {
  docker stop "$test_container" >/dev/null 2>&1 || true
}
trap cleanup_test_postgres EXIT INT TERM

docker run --rm -d \
  --name "$test_container" \
  -e POSTGRES_USER=openboard \
  -e POSTGRES_PASSWORD=openboard \
  -e POSTGRES_DB=postgres \
  -p 127.0.0.1::5432 \
  "$postgres_image" >/dev/null

# A cold container runs initdb before it accepts connections, which on a loaded
# or resource-constrained host takes far longer than a warm start. Bound the
# wait by wall clock rather than a poll count, so the budget does not shrink as
# each pg_isready gets slower under load.
postgres_ready=0
readiness_deadline=$((SECONDS + 60))
while ((SECONDS < readiness_deadline)); do
  if docker exec "$test_container" pg_isready -U openboard -d postgres >/dev/null 2>&1; then
    postgres_ready=1
    break
  fi
  sleep 0.2
done

if [[ "$postgres_ready" != "1" ]]; then
  echo "The test Postgres container did not become ready." >&2
  exit 1
fi

postgres_port="$(docker port "$test_container" 5432/tcp)"
postgres_port="${postgres_port##*:}"
TEST_POSTGRES_URL="postgresql://openboard:openboard@127.0.0.1:${postgres_port}/postgres" run_tests "$@"
