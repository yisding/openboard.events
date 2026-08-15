/** @vitest-environment happy-dom */

import * as React from "react";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ColumnDef } from "@tanstack/react-table";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DataTable, type DataTableSelectionContext } from "./data-table";
import { settle } from "@tests/support/react";

Object.assign(globalThis, { React });

type Row = { id: string; name: string; comments: number };

const columns: Array<ColumnDef<Row, unknown>> = [
  { accessorKey: "name", header: "Name" },
  { accessorKey: "comments", header: "Comments" },
];

const INITIAL: Row[] = [
  { id: "a", name: "Ada", comments: 0 },
  { id: "b", name: "Grace", comments: 0 },
  { id: "c", name: "Irene", comments: 0 },
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/**
 * `selected` is read out of the render callback so each assertion sees what the
 * bulk action bar would actually have been handed.
 */
function Harness({ onSelected }: { onSelected: (ids: string[]) => void }) {
  const [rows, setRows] = useState<Row[]>(INITIAL);
  return (
    <>
      <button
        type="button"
        data-testid="bump"
        onClick={() => {
          // Exactly what `files-admin-view`'s `onCommentAdded` does: a `.map()`
          // that returns a new array with one row updated in place.
          setRows((current) => current.map((row) => (row.id === "b" ? { ...row, comments: row.comments + 1 } : row)));
        }}
      />
      <button
        type="button"
        data-testid="filter"
        onClick={() => setRows((current) => current.filter((row) => row.id !== "c"))}
      />
      <DataTable<Row>
        data={rows}
        columns={columns}
        enableSelection
        empty={<span>No rows</span>}
        renderSelectionBar={(context: DataTableSelectionContext<Row>) => {
          onSelected(context.selectedRows.map((row) => row.id));
          return null;
        }}
      />
    </>
  );
}

describe("DataTable selection stability", () => {
  it("keeps a selection when a parent updates a row in place", async () => {
    let selected: string[] = [];
    await act(async () => { root.render(<Harness onSelected={(ids) => { selected = ids; }} />); });
    await settle();

    const checkboxes = [...container.querySelectorAll<HTMLInputElement>('tbody input[type="checkbox"]')];
    expect(checkboxes).toHaveLength(3);
    await act(async () => { checkboxes[0]?.click(); checkboxes[1]?.click(); });
    await settle();
    expect(selected.sort()).toEqual(["a", "b"]);

    // Replying in a row's comment thread bumps one count. Every `.map()`
    // returns a new array, and a new array reference used to clear the whole
    // selection — an organizer who had picked rows for a bulk export lost them
    // with no message. The rows themselves did not change.
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="bump"]')?.click(); });
    await settle();
    expect(selected.sort()).toEqual(["a", "b"]);
  });

  it("still clears a selection when the row set itself changes", async () => {
    let selected: string[] = [];
    await act(async () => { root.render(<Harness onSelected={(ids) => { selected = ids; }} />); });
    await settle();

    const checkboxes = [...container.querySelectorAll<HTMLInputElement>('tbody input[type="checkbox"]')];
    await act(async () => { checkboxes[0]?.click(); checkboxes[2]?.click(); });
    await settle();
    expect(selected.sort()).toEqual(["a", "c"]);

    // A filter drops a row: the reset still has to happen, and the row that
    // left must not linger in the selection.
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="filter"]')?.click(); });
    await settle();
    expect(selected).toEqual([]);
  });
});
