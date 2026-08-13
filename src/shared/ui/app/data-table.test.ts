import { describe, expect, it } from "vitest";
import type { Row as TableRow } from "@tanstack/react-table";
import { defaultRowId, nullsLast, selectionAnnouncement, selectionLabel } from "./data-table";

type ValueRow = { value: number | null };

function tableRow(value: number | null): TableRow<ValueRow> {
  return { getValue: () => value } as unknown as TableRow<ValueRow>;
}

function sortedValues(descending: boolean): Array<number | null> {
  const rows = [tableRow(null), tableRow(3), tableRow(5)];
  return rows
    .sort((a, b) => {
      const result = nullsLast(a, b, "value", descending);
      return descending ? result * -1 : result;
    })
    .map((row) => row.getValue("value"));
}

describe("DataTable helpers", () => {
  it("keeps empty values last in both sort directions", () => {
    expect(sortedValues(false)).toEqual([3, 5, null]);
    expect(sortedValues(true)).toEqual([5, 3, null]);
  });

  it("uses an id property before falling back to position", () => {
    expect(defaultRowId({ id: "stable-id", name: "Ada" }, 4)).toBe("stable-id");
    expect(defaultRowId({ name: "Ada" }, 4)).toBe("4");
  });

  it("names a selection checkbox for its specific row", () => {
    expect(selectionLabel({ code: "SESS-104", title: "Useful forms" }, "fallback", (row) => `${row.code}, ${row.title}`)).toBe("Select SESS-104, Useful forms");
    expect(selectionLabel({}, "row-7")).toBe("Select row row-7");
  });

  it("announces page-local selection changes without speaking the initial empty state", () => {
    expect(selectionAnnouncement(0, 0)).toBeNull();
    expect(selectionAnnouncement(0, 1)).toBe("1 row selected on this page.");
    expect(selectionAnnouncement(1, 3)).toBe("3 rows selected on this page.");
    expect(selectionAnnouncement(3, 0)).toBe("Selection cleared.");
  });
});
