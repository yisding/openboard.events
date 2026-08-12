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

  it("bottom-aligns the email submit control with its 40px input", () => {
    const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
    const source = readFileSync(new URL("./components/cfp-steps.tsx", import.meta.url), "utf8");

    expect(source).toContain('className="form-grid cfp-account-form"');
    expect(css).toContain(".cfp-account-form{align-items:end}");
    expect(css).toContain(".cfp-account-form>.button{height:40px}");
  });

  it("lets the short account and confirmation states size to their content", () => {
    const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
    const source = readFileSync(new URL("./components/cfp-steps.tsx", import.meta.url), "utf8");

    expect(source).toContain('className={`cfp-step${step === "account" ? " cfp-step--compact" : ""}`}');
    expect(source).toContain('className="cfp-step cfp-step--compact"');
    expect(css).toContain(".cfp-step.cfp-step--compact{min-height:0}");
  });

  it("keeps mobile verification actions and rich-text tools vertically regular", () => {
    const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
    const mobile = mediaBlocks(css, "@media(max-width:768px)").join("\n");
    const phone = mediaBlocks(css, "@media(max-width:480px)").join("\n");

    expect(mobile).toContain(".rich-text-editor__toolbar{display:grid;grid-template-columns:repeat(5,minmax(44px,56px));gap:4px;align-items:center;overflow-x:auto}");
    expect(mobile).toContain(".rich-text-editor__tool{width:100%}");
    expect(mobile).toContain(".cfp-account-form>.demo-code+.cfp-code-actions{grid-column:1}");
    expect(phone).toContain(".cfp-account-form>.cfp-code-actions{display:grid;grid-template-columns:1fr 1fr}");
    expect(phone).toContain(".cfp-account-form>.cfp-code-actions>.button:last-child{grid-column:1/-1}");
    expect(phone).toContain(".public-form-progress:has(>li:nth-child(4)){display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}");
    expect(phone).toContain(".public-form-progress:has(>li:nth-child(4)) li:nth-child(2)::after{display:none}");
  });
});
