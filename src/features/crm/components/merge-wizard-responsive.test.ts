import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("CRM merge choice sizing", () => {
  it("keeps radio glyphs from inheriting text-input dimensions", () => {
    const css = readFileSync(new URL("../../../app/globals.css", import.meta.url), "utf8");

    expect(css).toContain(".crm-merge-compare input[type=radio]{width:16px;height:16px;min-width:16px;min-height:16px;flex:0 0 16px;margin:2px 0 0;padding:0");
  });
});
