import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

/**
 * The browser-side budget gate (M05b step 4). Like the CSS colour gate beside
 * it, it shipped without a test — and a size gate that stops measuring is
 * indistinguishable from a bundle that never grows.
 *
 * The fixture is a miniature `.next`: an `app-build-manifest.json` and a couple
 * of chunk files whose *gzipped* size is what the script actually reports, so
 * the bytes are random rather than repetitive — a compressible fixture would
 * make every budget assertion here a test of zlib instead of the gate.
 */
const CHECKER = resolve("node_modules/.bin/tsx");
const SCRIPT = resolve("scripts/check-client-bundle.ts");
const CACHE_ROOT = resolve("node_modules/.cache");
const ROUTE = "/kitchen-sink/rich/page";
const fixtures: string[] = [];

function root(): string {
  mkdirSync(CACHE_ROOT, { recursive: true });
  const created = mkdtempSync(resolve(CACHE_ROOT, "client-bundle-"));
  fixtures.push(created);
  return created;
}

/** ~`kb` kilobytes that gzip cannot shrink, so the reported size is the written one. */
function incompressible(path: string, kb: number): void {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, randomBytes(Math.round(kb * 1024)));
}

function build(pages: Record<string, string[]>, chunks: Record<string, number> = {}): string {
  const created = root();
  const next = resolve(created, ".next");
  mkdirSync(next, { recursive: true });
  writeFileSync(resolve(next, "app-build-manifest.json"), JSON.stringify({ pages }));
  for (const files of Object.values(pages)) {
    for (const file of files) incompressible(resolve(next, file), 40);
  }
  // `static/chunks` is always read, even when it holds nothing interesting.
  mkdirSync(resolve(next, "static/chunks"), { recursive: true });
  for (const [name, kb] of Object.entries(chunks)) incompressible(resolve(next, "static/chunks", name), kb);
  return created;
}

function check(cwd: string, env: Record<string, string> = {}) {
  return spawnSync(CHECKER, [SCRIPT], { cwd, encoding: "utf8", env: { ...process.env, ...env } });
}

afterEach(() => {
  for (const created of fixtures.splice(0)) rmSync(created, { recursive: true, force: true });
});

describe("client bundle budget gate", () => {
  it("tells you to build instead of silently passing when there is no manifest", () => {
    const result = check(root());
    // Not 0 and not 1: "we could not measure" is its own outcome, and treating
    // it as a pass is exactly how a budget gate stops gating.
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("run pnpm build first");
  });

  it("names the routes it does know when the measured route is gone", () => {
    const cwd = build({ "/other/page": ["static/chunks/other.js"] });

    const result = check(cwd);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(`route ${ROUTE} is not in the build manifest`);
    expect(result.stderr).toContain("/other/page");
  });

  it("passes under budget and reports the lazy editor chunk it is deliberately not counting", () => {
    const cwd = build(
      { [ROUTE]: ["static/chunks/main-app.js", "static/chunks/page.js"] },
      { "unrelated.js": 10 },
    );
    // The editor chunk is found by the one string that identifies it, not by
    // filename — that is what keeps it measurable after a hash-name change.
    writeFileSync(resolve(cwd, ".next/static/chunks/editor.js"), Buffer.concat([
      Buffer.from("/* ProseMirror */"),
      randomBytes(120 * 1024),
    ]));

    const result = check(cwd, { CLIENT_BUNDLE_BUDGET_KB: "300", CLIENT_BUNDLE_WARN_KB: "250" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(`first-load JS for ${ROUTE}`);
    // ~80 KB of first-load across two 40 KB chunks — under budget, and the
    // 120 KB editor is reported separately rather than folded into it.
    expect(result.stdout).toMatch(/first-load JS for .*: 8\d\.\d KB gzip/);
    expect(result.stdout).toContain("lazy editor chunk: 12");
    expect(result.stderr).toBe("");
  });

  it("says so plainly when no chunk carries the editor", () => {
    const cwd = build({ [ROUTE]: ["static/chunks/page.js"] }, { "unrelated.js": 10 });

    const result = check(cwd, { CLIENT_BUNDLE_BUDGET_KB: "300" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("which is the point of ssr:false");
  });

  it("fails the build over budget, with the remedy in the message", () => {
    const cwd = build({ [ROUTE]: ["static/chunks/page.js"] });

    const result = check(cwd, { CLIENT_BUNDLE_BUDGET_KB: "20", CLIENT_BUNDLE_WARN_KB: "10" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("exceeds the 20 KB budget");
    expect(result.stderr).toContain("fall back to the plain textarea");
  });

  it("warns in the band between the warn line and the budget without failing", () => {
    const cwd = build({ [ROUTE]: ["static/chunks/page.js"] });

    const result = check(cwd, { CLIENT_BUNDLE_BUDGET_KB: "300", CLIENT_BUNDLE_WARN_KB: "20" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain("above the 20 KB threshold");
  });
});
