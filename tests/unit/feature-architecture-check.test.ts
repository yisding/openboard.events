import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const CHECKER = resolve("node_modules/.bin/tsx");
const SCRIPT = resolve("scripts/check-feature-architecture.ts");
const CACHE_ROOT = resolve("node_modules/.cache");
const fixtures: string[] = [];

type Baseline = {
  directCrossFeatureImports: string[];
  featureCycles: string[][];
  serverUiImports: string[];
};

const emptyBaseline = (): Baseline => ({
  directCrossFeatureImports: [],
  featureCycles: [],
  serverUiImports: [],
});

function fixture(files: Record<string, string>, baseline: Baseline = emptyBaseline()): string {
  mkdirSync(CACHE_ROOT, { recursive: true });
  const root = mkdtempSync(resolve(CACHE_ROOT, "feature-architecture-"));
  fixtures.push(root);
  for (const [path, contents] of Object.entries(files)) {
    const absolute = resolve(root, path);
    mkdirSync(resolve(absolute, ".."), { recursive: true });
    writeFileSync(absolute, contents);
  }
  const baselinePath = resolve(root, "architecture/feature-boundaries-baseline.json");
  mkdirSync(resolve(baselinePath, ".."), { recursive: true });
  writeFileSync(baselinePath, JSON.stringify(baseline, null, 2));
  return root;
}

function check(root: string) {
  return spawnSync(CHECKER, [SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, ARCHITECTURE_CHECK_ROOT: root },
  });
}

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("feature architecture checker", () => {
  it("accepts a cross-feature dependency through the target's public index", () => {
    const root = fixture({
      "src/features/alpha/service.ts": 'import { value } from "@/features/beta"; export { value };',
      "src/features/beta/index.ts": "export const value = 1;",
    });

    const result = check(root);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("0 direct-import debts");
  });

  it("does not treat a nested index as a feature public entrypoint", () => {
    const root = fixture({
      "src/features/alpha/contest.ts": 'import { value } from "@/features/beta/internal"; export { value };',
      "src/features/beta/internal/index.ts": "export const value = 1;",
    });

    const result = check(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("src/features/alpha/contest.ts -> @/features/beta/internal");
  });

  it("rejects a new direct boundary bypass and server-to-UI import", () => {
    const root = fixture({
      "src/features/alpha/server/query.ts": 'import { Card } from "@/features/beta/components/card"; export { Card };',
      "src/features/beta/components/card.tsx": "export const Card = () => null;",
    });

    const result = check(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Direct cross-feature imports baseline drift");
    expect(result.stderr).toContain("Server-to-UI/route imports baseline drift");
  });

  it("requires a reviewed debt baseline to shrink when the violating import is removed", () => {
    const debt = "src/features/alpha/service.ts -> @/features/beta/internal";
    const root = fixture({
      "src/features/alpha/service.ts": 'import { value } from "@/features/beta/internal"; export { value };',
      "src/features/beta/internal.ts": "export const value = 1;",
    }, {
      ...emptyBaseline(),
      directCrossFeatureImports: [debt],
    });

    expect(check(root).status).toBe(0);
    writeFileSync(
      resolve(root, "src/features/alpha/service.ts"),
      'import { value } from "@/features/beta"; export { value };',
    );
    writeFileSync(resolve(root, "src/features/beta/index.ts"), "export { value } from \"./internal\";");

    const stale = check(root);
    expect(stale.status).toBe(1);
    expect(stale.stderr).toContain(`- ${debt}`);
  });

  it("rejects a newly cyclic feature group even when every edge uses a public index", () => {
    const root = fixture({
      "src/features/alpha/index.ts": 'export { beta } from "@/features/beta"; export const alpha = 1;',
      "src/features/beta/index.ts": 'export { alpha } from "@/features/alpha"; export const beta = 2;',
    });

    const result = check(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Feature cycles baseline drift");
    expect(result.stderr).toContain("alpha -> beta");
  });
});
