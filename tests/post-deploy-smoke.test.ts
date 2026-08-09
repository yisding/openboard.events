import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const created: string[] = [];

afterEach(() => {
  for (const path of created.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("post-deploy smoke retries", () => {
  it("does not retain an early schedule status failure after a later success", () => {
    const root = mkdtempSync(join(tmpdir(), "openboard-smoke-test-"));
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
case "$url" in
  */api/health) payload='{"ok":true,"ms":1}' ;;
  */e/*/schedule)
    count_file="$SMOKE_FAKE_STATE/schedule"
    count=0
    [[ -f "$count_file" ]] && count="$(<"$count_file")"
    count=$((count+1))
    echo "$count" > "$count_file"
    if (( count == 1 )); then status=503
    elif (( count >= 3 )); then extra=$'Cache-Control: public, s-maxage=60\\r\\n'
    fi
    ;;
  */embed/*/schedule) extra=$'Content-Security-Policy: frame-ancestors *\\r\\n' ;;
  */api/v1/events/*/schedule) payload='{"data":[]}' ;;
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
      },
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("ok    /e/ai-engineer-sandbox-event/schedule");
    expect(result.stdout).not.toContain("FAIL  public schedule renders");
  });
});
