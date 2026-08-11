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

function mediaBlocks(css: string, query: string): string[] {
  const blocks: string[] = [];
  let cursor = 0;
  while (cursor < css.length) {
    const start = css.indexOf(query, cursor);
    if (start < 0) break;
    const block = cssBlockAt(css, start);
    blocks.push(block);
    cursor = start + block.length;
  }
  return blocks;
}

describe("CFP progress responsive styles", () => {
  it("compacts the progress labels and connectors through the 768px mobile breakpoint", () => {
    const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
    const mobileBlock = mediaBlocks(css, "@media(max-width:768px)")
      .find((block) => block.includes(".cfp-progress"));

    expect(mobileBlock).toBeDefined();
    expect(mobileBlock).toContain(".cfp-progress b{display:none}");
    expect(mobileBlock).toContain(".cfp-progress i{width:25px;margin:0 6px}");
  });
});
