import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function mobileCss(css: string): string {
  const start = css.indexOf("@media(max-width:768px){", css.indexOf("/* The data toolbar"));
  const end = css.indexOf("\n}", start);
  return css.slice(start, end);
}

describe("form list mobile toolbars", () => {
  it("uses the responsive toolbar hook on submission and portal form lists", () => {
    const submissions = readFileSync(new URL("./forms-page.tsx", import.meta.url), "utf8");
    const portal = readFileSync(new URL("../portal/form-builder/components/portal-forms-page.tsx", import.meta.url), "utf8");

    expect(submissions).toContain('className="list-toolbar form-list-toolbar"');
    expect(portal).toContain('className="list-toolbar form-list-toolbar"');
    expect(submissions).toContain('aria-label="Search forms"');
    expect(portal).toContain('aria-label="Search forms"');
  });

  it("scrolls filter tabs and gives search a full-width mobile row", () => {
    const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
    const mobile = mobileCss(css);

    expect(mobile).toContain(".form-list-toolbar>.tabs{width:100%;overflow-x:auto;");
    expect(mobile).toContain(".form-list-toolbar>.tabs button{min-height:44px;flex:0 0 auto}");
    expect(mobile).toContain(".form-list-toolbar>input{width:100%;min-width:0;min-height:44px;flex:1 0 100%}");
  });
});
