import { describe, expect, it } from "vitest";
import type { Row as TableRow } from "@tanstack/react-table";
import { defaultRowId, nullsLast } from "./data-table";

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
});
