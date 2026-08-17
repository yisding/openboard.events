import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

/**
 * The gate that keeps `globals.css`'s opening promise — "every colour in this
 * stylesheet resolves to one of these" — true. It had no test of its own, which
 * for a checker is the worst state to be in: a silently-stopped gate reports
 * success forever, and the first anyone hears of it is a hex nobody can name
 * sitting in production CSS.
 *
 * Same fixture-root shape as `source-invariants.test.ts` and
 * `feature-architecture-check.test.ts`: the real script, spawned against a
 * throwaway tree, so what is asserted is the gate's actual exit status.
 */
const CHECKER = resolve("node_modules/.bin/tsx");
const SCRIPT = resolve("scripts/check-css-color-tokens.ts");
const CACHE_ROOT = resolve("node_modules/.cache");
const fixtures: string[] = [];

function fixture(files: Record<string, string>): string {
  mkdirSync(CACHE_ROOT, { recursive: true });
  const root = mkdtempSync(resolve(CACHE_ROOT, "css-color-tokens-"));
  fixtures.push(root);
  for (const [path, contents] of Object.entries(files)) {
    const absolute = resolve(root, path);
    mkdirSync(resolve(absolute, ".."), { recursive: true });
    writeFileSync(absolute, contents);
  }
  return root;
}

function check(root: string) {
  return spawnSync(CHECKER, [SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, SOURCE_INVARIANT_ROOT: root },
  });
}

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("CSS colour token gate", () => {
  it("accepts every place a hex is legitimately spelled out", () => {
    const root = fixture({
      "src/app/globals.css": [
        ":root {",
        "  --ink: #101014;",
        "  --accent: #4f46e5;",
        "}",
        "/* The old value was #ff0000 — see #117 for why it changed. */",
        ".chevron{background-image:url(\"data:image/svg+xml;utf8,<svg fill='#101014'/>\")}",
        ".fade{mask-image:linear-gradient(to right,#000,transparent)}",
        ".card{color:var(--ink);border:1px solid var(--accent)}",
      ].join("\n"),
      // Nested stylesheets are scanned too, and this one is clean.
      "src/features/agenda/grid.css": ".grid-slot{background:var(--fill)}",
    });

    const result = check(root);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("rejects a raw hex outside :root and points at the line it is on", () => {
    const root = fixture({
      "src/features/agenda/grid.css": [
        ":root {",
        "  --grid-line: #dcdce4;",
        "}",
        "",
        ".grid-slot{border-color:#dcdce4}",
      ].join("\n"),
    });

    const result = check(root);
    expect(result.status).toBe(1);
    // The line number is the whole point of the report, and the checker earns
    // it by blanking exempt regions to spaces rather than deleting them — a
    // regression there still reports the violation, just at the wrong place.
    expect(result.stderr).toContain("src/features/agenda/grid.css:5 raw colour #dcdce4");
    expect(result.stderr).toContain("1 violation");
  });

  it("does not let a hex hide inside a comment or a data URI it is adjacent to", () => {
    const root = fixture({
      "src/app/globals.css": [
        "/* multi-line comment",
        "   mentioning #abcdef */",
        ".a{background-image:url(\"data:image/svg+xml;utf8,<svg fill='#fff'/>\");color:#123456}",
      ].join("\n"),
    });

    const result = check(root);
    expect(result.status).toBe(1);
    // Exactly one violation: the declaration after the data URI, on line 3.
    expect(result.stderr).toContain("src/app/globals.css:3 raw colour #123456");
    expect(result.stderr).toContain("1 violation");
    expect(result.stderr).not.toContain("#abcdef");
  });

  it("counts every violation across every stylesheet instead of stopping at the first", () => {
    const root = fixture({
      "src/app/globals.css": ".a{color:#111}",
      "src/shared/ui/kit.css": ".b{color:#222}\n.c{color:#333}",
    });

    const result = check(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("3 violations");
  });
});
