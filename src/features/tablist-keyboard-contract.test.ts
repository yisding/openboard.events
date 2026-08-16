import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("..", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return entry.endsWith(".tsx") && !/\.(?:test|spec)\.tsx$/u.test(entry) ? [path] : [];
  });
}

/**
 * `role="tablist"` is a promise of the whole ARIA tabs pattern, and the keyboard
 * half is the part that silently goes missing: a screen reader announces "tab 2
 * of 7, use arrow keys" off the roles alone, so a strip that declares them and
 * implements nothing is worse than a strip of plain buttons. A filter strip with
 * no panel to control is not a tab strip — those use `role="group"` with
 * `aria-pressed`, and this test is what keeps the two from being confused.
 */
describe("tablist keyboard contract", () => {
  it("gives every tab strip a roving tabIndex and arrow-key movement", () => {
    const strips = sourceFiles(SRC).filter((path) => readFileSync(path, "utf8").includes('role="tablist"'));
    expect(strips.length).toBeGreaterThan(0);
    for (const path of strips) {
      const source = readFileSync(path, "utf8");
      expect(source, path).toContain("tabIndex={");
      expect(source, path).toContain("moveRovingTab(");
    }
  });
});
