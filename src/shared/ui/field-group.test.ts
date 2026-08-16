import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A source guard for the `Field`/`group` rule proved in `field.test.ts`.
 *
 * `<button>` is a labelable element, so a `<label>` wrapping a set of choice
 * buttons labels the *first* one, and HTML-AAM then computes that button's name
 * from the label's whole text content minus its own — i.e. from every other
 * option beside it. The first choice answers to the last one's words and no
 * choice answers to its own. On the deployed build that made the form builder's
 * "Add a question" dialog unusable with a screen reader and unaddressable by a
 * role query, which is how it was found.
 *
 * The unit test proves `group` renders the fix; this proves nobody reintroduces
 * the bug in a new dialog. It is a source scan rather than a render test because
 * the defect lives in the *pairing* of a component with its children, which is
 * only visible where they are written together.
 */
const SRC = fileURLToPath(new URL("../..", import.meta.url));

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.isFile() && entry.name.endsWith(".tsx") ? [path] : [];
  });
}

/**
 * Where the opening tag that starts at `from` ends.
 *
 * Not `indexOf(">")`: a JSX attribute routinely contains one inside a brace
 * expression (`onClick={() => …}`), a string, or a comment, and stopping at the
 * first one truncates the tag — which would silently hide a `group` written
 * after it and turn this guard into a rubber stamp.
 */
function openTagEnd(source: string, from: number): number {
  let depth = 0;
  for (let index = from; index < source.length; index += 1) {
    const char = source[index];
    const pair = source.slice(index, index + 2);
    if (pair === "//") { index = source.indexOf("\n", index); if (index === -1) return -1; continue; }
    if (pair === "/*") { const close = source.indexOf("*/", index + 2); if (close === -1) return -1; index = close + 1; continue; }
    if (char === '"' || char === "'" || char === "`") {
      const close = source.indexOf(char, index + 1);
      if (close === -1) return -1;
      index = close;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    else if (char === ">" && depth === 0) return index;
  }
  return -1;
}

/** The body of each `<Field …>…</Field>`, paired with its own opening tag. */
function fieldElements(source: string): Array<{ open: string; body: string; index: number }> {
  const found: Array<{ open: string; body: string; index: number }> = [];
  const opener = /<Field\b/g;
  for (let match = opener.exec(source); match; match = opener.exec(source)) {
    const tagEnd = openTagEnd(source, match.index);
    if (tagEnd === -1) continue;
    const open = source.slice(match.index, tagEnd + 1);
    // Self-closing `<Field … />` has no children to mislabel.
    if (open.endsWith("/>")) continue;
    // Walk to the matching close so a nested `<Field>` is attributed to itself
    // rather than counted against the outer one.
    let depth = 1;
    let cursor = tagEnd + 1;
    const start = cursor;
    while (depth > 0) {
      const nextOpen = source.indexOf("<Field", cursor);
      const nextClose = source.indexOf("</Field>", cursor);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth += 1;
        cursor = nextOpen + 6;
      } else {
        depth -= 1;
        cursor = nextClose + 8;
        if (depth === 0) found.push({ open, body: source.slice(start, nextClose), index: match.index });
      }
    }
  }
  return found;
}

/**
 * The shapes a `<label>` must not be wrapped around.
 *
 * `<button>`/`<Segmented>` is the choice-grid case above. `<label>` is the
 * other one, and it is worse: a checkbox list — the speaker pickers, the bulk
 * send filters — gives every option its own `<label>`, and nesting a label
 * inside a label is invalid HTML with no defined parse. The outer one still
 * labels the first checkbox and names it after every other option's text, so
 * it fails the same way while looking nothing like the first case. It was
 * missed until #595 because the scan keyed on `<button` alone.
 */
const CONTROL_SET = /<button|<Segmented\b|<label\b/;

describe("Field never wraps a control set in a label", () => {
  it("marks every Field holding a set of controls as a group", () => {
    const offenders: string[] = [];
    for (const file of tsxFiles(SRC)) {
      const source = readFileSync(file, "utf8");
      if (!source.includes("<Field")) continue;
      for (const element of fieldElements(source)) {
        if (!CONTROL_SET.test(element.body)) continue;
        if (/\bgroup\b/.test(element.open)) continue;
        offenders.push(`${file.slice(SRC.length)}:${source.slice(0, element.index).split("\n").length}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("finds the Fields it is meant to be checking", () => {
    // A guard that silently matched nothing would pass forever. The form
    // builder's response-type grid is the case that exposed the bug.
    const source = readFileSync(join(SRC, "features/forms/form-builder.tsx"), "utf8");
    const grids = fieldElements(source).filter((element) => /<button/.test(element.body));
    expect(grids.length).toBeGreaterThan(0);
    expect(grids.every((element) => /\bgroup\b/.test(element.open))).toBe(true);
  });

  it("finds the checkbox lists too, which the button-only scan walked past", () => {
    // Both abstract drawers reach the same picker: the detail drawer through
    // the agenda's session dialog, the manual one inline. A scan that only
    // knew about buttons passed on `add-abstract-drawer.tsx` for a release.
    for (const path of ["features/agenda/components/session-form-dialog.tsx", "features/submissions/components/add-abstract-drawer.tsx"]) {
      const source = readFileSync(join(SRC, path), "utf8");
      const pickers = fieldElements(source).filter((element) => /<label\b/.test(element.body) && !/<button/.test(element.body));
      expect(pickers.length, path).toBeGreaterThan(0);
      expect(pickers.every((element) => /\bgroup\b/.test(element.open)), path).toBe(true);
    }
  });
});
