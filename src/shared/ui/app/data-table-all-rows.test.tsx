import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ColumnDef } from "@tanstack/react-table";
import { describe, expect, it } from "vitest";
import {
  DataTable,
  type DataTableAllRowsSelection,
  type DataTableSelectionContext,
} from "./data-table";

type Row = { id: string; name: string };

const columns: Array<ColumnDef<Row, unknown>> = [{ accessorKey: "name", header: "Name" }];
const wording: DataTableAllRowsSelection = {
  maxRows: 200,
  singularNoun: "deliverable",
  pluralNoun: "deliverables",
};

Object.assign(globalThis, { React });

function selectionContext(
  count: number,
  allRowsSelection?: DataTableAllRowsSelection,
  serverPaginated = false,
): DataTableSelectionContext<Row> {
  let context: DataTableSelectionContext<Row> | undefined;
  renderToStaticMarkup(
    <DataTable
      columns={columns}
      data={Array.from({ length: count }, (_, index) => ({ id: `row-${index}`, name: `Row ${index}` }))}
      empty={<p>No rows</p>}
      enableSelection
      {...(allRowsSelection ? { allRowsSelection } : {})}
      {...(serverPaginated
        ? { serverPagination: { page: 1, pageSize: 25, total: count, onPageChange: () => undefined } }
        : {})}
      renderSelectionBar={(selection) => {
        context = selection;
        return <span>{selection.countLabel}</span>;
      }}
    />,
  );
  if (!context) throw new Error("DataTable did not render its selection context");
  return context;
}

describe("DataTable bounded all-row opt-in", () => {
  it("leaves the default local table page-scoped", () => {
    const context = selectionContext(87);

    expect(context.scope).toBe("page");
    expect(context.totalRowCount).toBe(87);
    expect(context.pageRowCount).toBe(25);
    expect(context.selectAllRows).toBeUndefined();
  });

  it.each([87, 200])("offers but does not activate the all-row scope for %s local rows", (count) => {
    const context = selectionContext(count, wording);

    expect(context.scope).toBe("page");
    expect(context.countLabel).toBe("0 deliverables selected on this page");
    expect(context.selectAllRows).toEqual(expect.any(Function));
  });

  it("does not expose the escalation above the cap", () => {
    const context = selectionContext(201, wording);

    expect(context.scope).toBe("page");
    expect(context.selectAllRows).toBeUndefined();
  });

  it("refuses the local all-row opt-in for a server-paginated partial set", () => {
    const context = selectionContext(25, wording, true);

    expect(context.scope).toBe("page");
    expect(context.selectAllRows).toBeUndefined();
  });
});
