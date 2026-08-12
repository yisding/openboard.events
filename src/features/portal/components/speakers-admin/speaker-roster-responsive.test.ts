import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function cssBlockAt(css: string, start: number): string {
  const open = css.indexOf("{", start);
  if (open < 0) throw new Error("CSS block has no opening brace");
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    if (css[index] === "}") depth -= 1;
    if (depth === 0) return css.slice(start, index + 1);
  }
  throw new Error("CSS block has no closing brace");
}

function mediaBlockContaining(css: string, query: string, selector: string): string | undefined {
  let cursor = 0;
  while (cursor < css.length) {
    const start = css.indexOf(query, cursor);
    if (start < 0) return undefined;
    const block = cssBlockAt(css, start);
    if (block.includes(selector)) return block;
    cursor = start + block.length;
  }
  return undefined;
}

describe("speaker roster responsive forms", () => {
  const css = readFileSync(new URL("../../../../app/globals.css", import.meta.url), "utf8");
  const source = readFileSync(new URL("./speaker-roster-panels.tsx", import.meta.url), "utf8");
  const responsiveSelector = ".speaker-logistics-field-form,.speaker-unavailability-form";

  it("uses authored classes instead of inline grid templates", () => {
    expect(source).toContain('className="speaker-logistics-field-form"');
    expect(source).toContain('className="speaker-unavailability-form"');
    expect(source).not.toContain("gridTemplateColumns");
    expect(css).toContain(".speaker-logistics-field-form{width:100%;flex:1 1 100%;display:grid;");
    expect(css).toContain(".speaker-unavailability-form{display:grid;");
  });

  it("uses two columns on tablets and one column on phones", () => {
    const tablet = mediaBlockContaining(css, "@media(max-width:1024px)", responsiveSelector);
    const mobile = mediaBlockContaining(css, "@media(max-width:768px)", responsiveSelector);

    expect(tablet).toContain(`${responsiveSelector}{grid-template-columns:repeat(2,minmax(0,1fr))}`);
    expect(mobile).toContain(`${responsiveSelector}{grid-template-columns:1fr}`);
  });
});
