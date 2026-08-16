import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("TeamPanel responsive member rows", () => {
  it("stamps stable hooks on the members table without changing invitations", () => {
    const source = read("./team-panel.tsx");

    expect(source).toContain('className="panel settings-section organization-members-section"');
    expect(source).toContain('meta: { className: "organization-member-name" }');
    expect(source).toContain('meta: { className: "organization-member-role" }');
    expect(source).toContain('meta: { className: "organization-member-actions" }');
    expect(source.match(/organization-members-section/gu)).toHaveLength(1);
  });

  it("keeps the role selector and remove action in a phone-width control rail", () => {
    const css = read("../../../app/globals.css");

    expect(css).toContain(".organization-members-section .data-table tr{display:grid;grid-template-columns:minmax(0,1fr) 124px}");
    expect(css).toContain(".organization-members-section td.organization-member-name{grid-column:1;grid-row:1/3");
    expect(css).toContain(".organization-members-section td.organization-member-role{grid-column:2;grid-row:1;height:54px");
    // The actions cell keeps the rail's column and row, but not a fixed height:
    // its two buttons are 44px touch targets that wrap inside a 124px rail, so
    // a pinned 54px (and then the 62px every `.data-table td` gets) cut Remove
    // off. It grows instead, with 54px as the floor.
    expect(css).toContain(".organization-members-section td.organization-member-actions{grid-column:2;grid-row:2;height:auto;min-height:54px");
    expect(css).not.toContain(".organization-members-section td.organization-member-actions{grid-column:2;grid-row:2;height:54px");
  });
});
