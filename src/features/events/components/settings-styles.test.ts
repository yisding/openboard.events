import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Every class these components render must have a rule in `globals.css`.
 *
 * This is the check that would have caught the bug it was written for.
 * `.vocab-list`, `.vocab-row`, `.vocab-add`, `.vocab-color`, `.branding-editor`
 * and `.brand-preview` shipped with no rule at all — not in the demo page and
 * not in `vocab-tab.tsx`, the DB-backed editor that actually runs. With the
 * shared `input{width:100%}` underneath, every vocabulary row laid out as a
 * full-width stack: drag handle, colour well, name, capacity, duration and
 * delete button each on their own line.
 *
 * Nothing else in the suite or the design-system sweep can see this. The
 * rendered-DOM sweep in `design-system.md` T8 asserts that what *is* painted
 * sits on the type, spacing and touch grids — an element with no rule breaks
 * none of those, because a browser is perfectly happy to lay out an unstyled
 * div. And `vocab-tab.tsx` has no demo path, so it never reaches the sweep at
 * all. The only cheap signal is textual: does the class have a selector.
 */

const CSS = readFileSync(new URL("../../../app/globals.css", import.meta.url), "utf8");

/** Classes rendered by a component, minus the ones a `className={...}` builds. */
function renderedClasses(relativePath: string): string[] {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  const found = new Set<string>();
  for (const match of source.matchAll(/className="([^"{}]+)"/g)) {
    // `noUncheckedIndexedAccess` types a capture group as possibly undefined
    // even when the pattern guarantees it, so read it out rather than index
    // inline.
    const attribute = match[1] ?? "";
    for (const name of attribute.split(/\s+/)) if (name) found.add(name);
  }
  return [...found];
}

/**
 * Selector text only — comments stripped and declaration bodies dropped.
 *
 * Searching the whole stylesheet makes this test quietly self-defeating: the
 * comment introducing these rules names all six classes, so deleting every one
 * of the rules would still leave `.vocab-list` and friends in the file and the
 * test would keep passing. A check that its own documentation can satisfy is
 * not a check.
 */
const SELECTOR_TEXT = [
  ...CSS.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(?:^|[{};])([^{};]+)\{/g),
].map((match) => match[1] ?? "").join("\n");

/**
 * A class has a rule if it appears in selector position. The trailing guard
 * matters too: plain substring matching would pass `.vocab-color` on the
 * strength of a `.vocab-colors-legend` rule.
 */
function hasRule(className: string): boolean {
  return new RegExp(`\\.${className}(?![\\w-])`).test(SELECTOR_TEXT);
}

describe("event settings styles", () => {
  it.each([
    ["the DB-backed vocabulary editor", "./vocab-tab.tsx"],
    ["the settings shell", "./settings-shell.tsx"],
  ])("gives every class %s renders a rule in globals.css", (_label, path) => {
    const missing = renderedClasses(path).filter((name) => !hasRule(name));
    expect(missing).toEqual([]);
  });

  it("keeps the vocabulary row on one line rather than a stack of full-width inputs", () => {
    // `flex:1 1 0`, not `1 1 auto`: every input here inherits `width:100%` from
    // the base rule, and an `auto` basis makes that width the basis — so the
    // name field asks for the whole row and the fixed-size siblings shrink to
    // pay for it. Measured in Chrome, the 36px icon buttons collapsed to 17px
    // and the 44px colour well to 27px, and it worsened as the viewport grew.
    expect(CSS).toContain(".vocab-list>div,.vocab-row{display:flex;");
    expect(CSS).toContain(".vocab-list input{flex:1 1 0;min-width:0}");
    expect(CSS).toContain(".vocab-list>div>svg,.vocab-list>div>button,.vocab-list input[type=\"number\"],.vocab-list .vocab-color{flex:none}");
    expect(CSS).not.toContain(".vocab-list input{flex:1 1 auto");
  });

  it("scopes the colour well under .vocab-list so the input rule cannot out-specify it", () => {
    // `.vocab-list input` is (0,1,1); a bare `.vocab-color` is (0,1,0) and loses
    // whatever the source order says.
    expect(CSS).toContain(".vocab-list .vocab-color{width:44px;height:44px;");
    // No rule may open a selector with a bare `.vocab-color` compound — i.e. at
    // the start of the file or straight after a `}`, `;` or newline. Matching
    // "not preceded by a word character" is not the same test: a descendant
    // combinator is a space, so it would flag the scoped rule above too.
    expect(CSS).not.toMatch(/(^|[};\n])\s*\.vocab-color\s*\{/);
  });

  it("puts the settings section header on the type scale instead of the UA ratio", () => {
    // Bare, the <h2> inherited the UA's 1.5em off the 14px body and rendered at
    // 21px with a 17.43px block margin — neither on any scale in T1 or T4.
    expect(CSS).toContain(".settings-section>header h2{margin:0 0 4px;font-size:14px");
    expect(CSS).toContain(".settings-section>header p{margin:0;color:var(--muted);font-size:12.5px}");
  });
});
