#!/usr/bin/env bash
set -euo pipefail

mkdir -p .wrangler
output_file=".wrangler/worker-size.txt"
wrangler deploy --env production --dry-run 2>&1 | tee "$output_file"

gzip_kib=$(sed -nE 's/.*gzip[^0-9]*([0-9]+([.][0-9]+)?) KiB.*/\1/p' "$output_file" | tail -1)
[[ -n "$gzip_kib" ]] || { echo "Could not read compressed Worker size from Wrangler output" >&2; exit 2; }

awk -v size="$gzip_kib" 'BEGIN {
  if (size > 3072) { printf "Worker %.2f KiB exceeds the Workers Free 3072 KiB limit\n", size > "/dev/stderr"; exit 1 }
  if (size > 2560) { printf "warning: Worker %.2f KiB is above the 2560 KiB upgrade threshold\n", size > "/dev/stderr" }
  else { printf "Worker %.2f KiB is within the Workers Free size budget\n", size }
}'
