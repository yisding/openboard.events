import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const paths = [
  "./agenda/components/list-view.tsx",
  "./crm/components/directory-view.tsx",
  "./portal/deliverables/components/files-admin-view.tsx",
  "./portal/components/speakers-admin/speakers-admin-view.tsx",
] as const;

describe("canonical DataTable bulk bars", () => {
  it.each(paths)("hosts the only action bar inside DataTable in %s", (path) => {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    expect(source).toContain("renderSelectionBar={");
    expect(source).not.toContain('className="bulk-bar"');
    expect(source.match(/<BulkActionBar/g)).toHaveLength(1);
  });

  it("passes Abstracts' decision bar through its typed table renderer", () => {
    const view = readFileSync(new URL("./submissions/components/abstracts-view.tsx", import.meta.url), "utf8");
    const table = readFileSync(new URL("./submissions/components/abstracts-table.tsx", import.meta.url), "utf8");
    expect(view.match(/<DecisionBar/g)).toHaveLength(1);
    expect(view).toContain("renderSelectionBar: ({ selectedRows, countLabel");
    expect(table).toContain('DataTableProps<SubmissionListRow>["renderSelectionBar"]');
    expect(table).toContain("renderSelectionBar ? { renderSelectionBar }");
  });
});
