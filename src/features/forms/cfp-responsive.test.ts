import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("CFP progress responsive styles", () => {
  it("compacts the progress labels and connectors through the 768px mobile breakpoint", () => {
    const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
    const mobileBlock = css.match(/@media\(max-width:768px\)\{[^\n]*\.cfp-progress b\{display:none\}[^\n]*\.cfp-progress i\{width:25px;margin:0 6px\}/u);
    expect(mobileBlock).not.toBeNull();
  });
});
