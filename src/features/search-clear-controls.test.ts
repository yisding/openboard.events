import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("search clear controls", () => {
  const sources = [
    "./comms/components/comms-log-table.tsx",
    "./comms/components/suppressions-tab.tsx",
    "./crm/components/directory-view.tsx",
    "./portal/components/speakers-admin/speakers-admin-view.tsx",
    "./portal/deliverables/components/files-admin-view.tsx",
  ];

  it("names every icon-only clear-search button", () => {
    for (const path of sources) {
      const source = read(path);
      expect(source, path).toMatch(/aria-label="Clear search"[\s\S]{0,200}<X size=\{14\} \/><\/button>/u);
    }
  });

  it("provides full desktop and compact pointer targets", () => {
    const css = read("../app/globals.css");
    expect(css).toContain(".table-search button{min-width:24px;min-height:24px;");
    expect(css).toContain(".table-search button { min-width: 44px; min-height: 44px; margin-right: -8px; }");
  });
});
