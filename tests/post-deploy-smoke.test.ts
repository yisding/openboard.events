import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const created: string[] = [];

afterEach(() => {
  for (const path of created.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("post-deploy smoke retries", () => {
  it("rejects old cached HTML until the deployed build regenerates it", () => {
    const scratch = join(homedir(), "Code");
    mkdirSync(scratch, { recursive: true });
    const root = mkdtempSync(join(scratch, "openboard-smoke-test-"));
    created.push(root);
    const bin = join(root, "bin");
    const state = join(root, "state");
    mkdirSync(bin, { recursive: true });
    mkdirSync(state, { recursive: true });

    const curl = join(bin, "curl");
    writeFileSync(curl, `#!/usr/bin/env bash
set -eu
args=("$@")
url="\${args[\${#args[@]}-1]}"
body=""
headers=""
for ((i=0; i<\${#args[@]}; i++)); do
  [[ "\${args[$i]}" == "-o" ]] && body="\${args[$((i+1))]}"
  [[ "\${args[$i]}" == "-D" ]] && headers="\${args[$((i+1))]}"
done
status=200
payload='{}'
extra=''
# The surface map mirrors the deployed one after M53: /e/<slug>/agenda is the
# canonical cached page, /e/<slug>/schedule is the legacy redirect, and the
# embed reads its style from the saved row so it is edge-cached too. Both cached
# surfaces open cold — a 503, then STALE and HIT responses carrying the old
# deployment marker — before regeneration succeeds and HIT carries the unique
# marker for this run (the git build may be identical on a workflow rerun).
cold_then_cached() {
  local count_file="$SMOKE_FAKE_STATE/$1"
  local count=0
  [[ -f "$count_file" ]] && count="$(<"$count_file")"
  count=$((count+1))
  echo "$count" > "$count_file"
  if (( count == 1 )); then status=503
  elif (( count == 2 )); then
    extra="$extra"$'X-Nextjs-Cache: STALE\\r\\n'
    payload='<span hidden data-openboard-deployment="old-deployment"></span>'
  elif (( count == 3 )); then
    extra="$extra"$'X-Nextjs-Cache: HIT\\r\\n'
    payload='<span hidden data-openboard-deployment="old-deployment"></span>'
  else
    extra="$extra"$'X-Nextjs-Cache: HIT\\r\\n'
    payload='<span hidden data-openboard-deployment="new-deployment"></span>'
  fi
}
case "$url" in
  */api/health) payload='{"ok":true,"sha":"same-build","deployment":"new-deployment","errors":{"ok":true,"windowSeconds":3600,"recentCount":0},"jobs":{"ok":true,"outboxLastSuccessAgeSeconds":30},"ms":1}' ;;
  */api/auth/get-session) payload='null' ;;
  */api/v1/events/*/schedule) payload='{"data":[]}' ;;
  */embed/*/agenda)
    extra=$'Content-Security-Policy: frame-ancestors *\\r\\n'
    cold_then_cached embed
    ;;
  */e/*/agenda) cold_then_cached agenda ;;
  */e/*/schedule)
    status=307
    extra=$'Location: /e/ai-engineer-sandbox-event/agenda\\r\\n'
    ;;
esac
printf 'HTTP/1.1 %s Test\\r\\n%s\\r\\n' "$status" "$extra" > "$headers"
printf '%s' "$payload" > "$body"
printf '%s' "$status"
`);
    chmodSync(curl, 0o755);
    const sleep = join(bin, "sleep");
    writeFileSync(sleep, "#!/usr/bin/env bash\nexit 0\n");
    chmodSync(sleep, 0o755);

    const result = spawnSync("bash", [resolve("scripts/post-deploy-smoke.sh"), "https://example.test"], {
      cwd: resolve("."),
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        SMOKE_FAKE_STATE: state,
        NEXT_PUBLIC_BUILD_SHA: "same-build",
        DEPLOYMENT_ID: "new-deployment",
      },
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("ok    /api/auth/get-session");
    expect(result.stdout).toContain("ok    /e/ai-engineer-sandbox-event/schedule");
    expect(result.stdout).not.toContain("FAIL  public schedule renders");
    expect(readFileSync(join(state, "agenda"), "utf8").trim()).toBe("4");
    expect(readFileSync(join(state, "embed"), "utf8").trim()).toBe("4");
  });
});
