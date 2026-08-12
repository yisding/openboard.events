import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const created: string[] = [];

afterEach(() => {
  for (const path of created.splice(0)) rmSync(path, { recursive: true, force: true });
});

function run(payload: Record<string, unknown>) {
  const scratch = join(homedir(), "Code");
  mkdirSync(scratch, { recursive: true });
  const root = mkdtempSync(join(scratch, "openboard-uptime-test-"));
  created.push(root);
  const bin = join(root, "bin");
  mkdirSync(bin, { recursive: true });
  const curl = join(bin, "curl");
  writeFileSync(curl, `#!/usr/bin/env bash
set -eu
body=""
args=("$@")
for ((i=0; i<\${#args[@]}; i++)); do
  [[ "\${args[$i]}" == "-o" ]] && body="\${args[$((i+1))]}"
done
printf '%s' "$UPTIME_FAKE_PAYLOAD" > "$body"
printf '200'
`);
  chmodSync(curl, 0o755);
  return spawnSync("bash", [resolve("scripts/uptime-check.sh"), "https://example.test"], {
    cwd: resolve("."),
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      UPTIME_FAKE_PAYLOAD: JSON.stringify(payload),
    },
  });
}

const healthy = {
  ok: true,
  db: { ok: true, version: "18" },
  comms: { ok: true, queuedCount: 0, failedCount: 0, oldestQueuedAgeSeconds: null },
  errors: { ok: true, windowSeconds: 3600, recentCount: 0, latestAgeSeconds: null },
  jobs: {
    ok: true,
    outboxLastSuccessAgeSeconds: 30,
    remindersLastSuccessAgeSeconds: 300,
    cleanupLastSuccessAgeSeconds: 3600,
  },
};

describe("uptime operational-error threshold", () => {
  it("passes a healthy empty error window", () => {
    const result = run(healthy);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("uptime check OK");
  });

  it("pages on one caught unexpected error in the last hour", () => {
    const result = run({ ...healthy, errors: { ...healthy.errors, recentCount: 1, latestAgeSeconds: 30 } });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("errors.recentCount=1");
  });

  it("pages when the error aggregate itself is unavailable", () => {
    const result = run({ ...healthy, errors: { ok: false, error: "operational error health check failed" } });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("errors.ok=false");
  });

  it("warns without failing during the additive rollout when the field is absent", () => {
    const oldHealth: Record<string, unknown> = { ...healthy };
    delete oldHealth.errors;
    const result = run(oldHealth);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("health has no errors aggregate");
  });
});

describe("uptime scheduled-job heartbeat threshold", () => {
  it("warns without failing while an older health schema is still deployed", () => {
    const oldHealth: Record<string, unknown> = { ...healthy };
    delete oldHealth.jobs;
    const result = run(oldHealth);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("health has no scheduled-jobs heartbeat");
  });

  it("pages when the heartbeat query is unavailable", () => {
    const result = run({ ...healthy, jobs: { ok: false, error: "scheduled jobs health check failed" } });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("jobs.ok=false");
  });

  it("pages when no outbox job has ever completed", () => {
    const result = run({ ...healthy, jobs: { ...healthy.jobs, outboxLastSuccessAgeSeconds: null } });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("no successful outbox heartbeat");
  });

  it("warns after three minutes and pages after five", () => {
    const warning = run({ ...healthy, jobs: { ...healthy.jobs, outboxLastSuccessAgeSeconds: 181 } });
    expect(warning.status).toBe(0);
    expect(warning.stdout).toContain("exceeds warn threshold (180)");

    const page = run({ ...healthy, jobs: { ...healthy.jobs, outboxLastSuccessAgeSeconds: 301 } });
    expect(page.status).toBe(1);
    expect(page.stdout).toContain("exceeds page threshold (300)");
  });
});
