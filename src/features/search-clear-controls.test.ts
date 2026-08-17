import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const FEATURES_ROOT = resolve(fileURLToPath(import.meta.url), "..");
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

function componentFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return componentFiles(path);
    return entry.name.endsWith(".tsx") && !entry.name.includes(".test.") ? [path] : [];
  });
}

/**
 * #638 — every search field in the product is one component.
 *
 * Twelve toolbars each rebuilt `.table-search` by hand, so only five ever
 * shipped the clear (X) and two shipped as a bare `<input>` with no box at all.
 * The gap is not cosmetic: a filter you cannot undo in one click is the
 * difference between "No forms here" meaning *you have none* and it meaning
 * *you typed something four screens ago*. `SearchInput` owns the recipe, so a
 * hand-rolled copy is the regression to catch — not the presence of any one
 * clear button.
 */
describe("search fields", () => {
  it("are never rebuilt by hand around an input", () => {
    const rebuilt = componentFiles(FEATURES_ROOT)
      // The box's class on an element that also contains a text input: a search
      // field written out longhand. `task-list.tsx` reuses the same box around a
      // <Select>, which is a filter rather than a search, and stays legitimate.
      .filter((path) => /className=\{?"table-search[^"]*"[\s\S]{0,600}?<input/u.test(readFileSync(path, "utf8")))
      .map((path) => relative(FEATURES_ROOT, path));

    expect(rebuilt).toEqual([]);
  });

  it("provides full desktop and compact pointer targets for the clear control", () => {
    const css = read("../app/globals.css");
    expect(css).toContain(".table-search button{min-width:24px;min-height:24px;");
    expect(css).toContain(".table-search button { min-width: 44px; min-height: 44px; margin-right: -8px; }");
  });
});
