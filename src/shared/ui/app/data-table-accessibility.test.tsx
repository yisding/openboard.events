import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ColumnDef } from "@tanstack/react-table";
import { describe, expect, it } from "vitest";
import { DataTable } from "./data-table";

type Row = { id: string; name: string };

const columns: Array<ColumnDef<Row, unknown>> = [
  { accessorKey: "name", header: "Name" },
];

Object.assign(globalThis, { React });

function renderTable(isLoading: boolean): string {
  return renderToStaticMarkup(
    <DataTable
      columns={columns}
      data={[]}
      empty={<p>No rows</p>}
      isLoading={isLoading}
    />,
  );
}

describe("DataTable loading accessibility", () => {
  it("announces loading and marks the table region busy", () => {
    const html = renderTable(true);

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="status"');
    expect(html).toContain("Loading table data…");
    expect(html).not.toContain("No rows");
  });

  it("removes the loading announcement when data settles", () => {
    const html = renderTable(false);

    expect(html).toContain('aria-busy="false"');
    expect(html).toContain('<p class="sr-only" role="status"></p>');
    expect(html).not.toContain("Loading table data…");
    expect(html).toContain("No rows");
  });
});
