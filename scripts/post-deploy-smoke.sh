#!/usr/bin/env bash
set -euo pipefail
base_url="${1:?usage: post-deploy-smoke.sh URL}"
curl -fsS "$base_url/api/health" | grep -q '"ok":true'
curl -fsS "$base_url/e/ai-engineer/schedule" | grep -q 'AI Engineer'
curl -fsS "$base_url/api/v1/events/ai-engineer/schedule" | grep -q '"data"'
echo "Post-deploy smoke passed"
