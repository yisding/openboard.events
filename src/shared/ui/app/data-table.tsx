"use client";

import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type Row as TableRow,
  type VisibilityState,
} from "@tanstack/react-table";
import { ChevronDown, ChevronUp, Columns3 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

/**
 * The one table in the product. Building a second one is a review-blocker: six
 * list surfaces share these semantics, and the three edge cases below are ones
 * each of them would otherwise hit separately.
 *
 * ```tsx
 * <DataTable
 *   columns={cols}                      // ColumnDef<SubmissionListRow>[], defined in the feature
 *   data={rows}
 *   isLoading={query.isPending}
 *   empty={<EmptyState … />}            // required: there is no undesigned empty state
 *   enableSelection
 *   onSelectionChange={setSelected}
 *   columnVisibilityKey={`abstracts:${eventId}`}
 *   onRowClick={(row) => openDrawer(row.id)}
 *   toolbar={<SearchInput … />}
 * />
 * ```
 *
 * Selection is **page-local**: selecting all selects the rows you can see, which
 * is what the bulk bar's count means and what the decision mutations expect.
 */
export type DataTableProps<Row> = {
  columns: Array<ColumnDef<Row, unknown>>;
  data: Row[];
  /** Required. Rendered only after loading, when there is nothing to show. */
  empty: ReactNode;
  isLoading?: boolean;
  toolbar?: ReactNode;
  enableSelection?: boolean;
  onSelectionChange?: (rows: Row[]) => void;
  /** localStorage key for hidden columns. Scope it per event. */
  columnVisibilityKey?: string;
  onRowClick?: (row: Row) => void;
  pageSize?: number;
  /** Stable row identity; defaults to `row.id` when present. */
  getRowId?: (row: Row, index: number) => string;
};

/**
 * Nulls sort last in *both* directions. The Rating column is the reason: a
 * default comparator puts unreviewed submissions first on one click and last on
 * the other, so "sort by rating" never shows the best proposals.
 */
export function nullsLast<TData>(rowA: TableRow<TData>, rowB: TableRow<TData>, columnId: string): number {
  const a = rowA.getValue(columnId);
  const b = rowB.getValue(columnId);
  const aEmpty = a === null || a === undefined || a === "";
  const bEmpty = b === null || b === undefined || b === "";
  if (aEmpty && bEmpty) return 0;
  // The sign is flipped back by TanStack when the direction is descending, so
  // returning a fixed order here would put empties first on one of the clicks.
  if (aEmpty) return 1;
  if (bEmpty) return -1;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

function readVisibility(key: string | undefined): VisibilityState {
  if (!key || typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(`openboard:columns:${key}`);
    return raw ? JSON.parse(raw) as VisibilityState : {};
  } catch {
    return {};
  }
}

export function DataTable<Row>({
  columns,
  data,
  empty,
  isLoading = false,
  toolbar,
  enableSelection = false,
  onSelectionChange,
  columnVisibilityKey,
  onRowClick,
  pageSize = 25,
  getRowId,
}: DataTableProps<Row>) {
  const [sorting, setSorting] = useState<Array<{ id: string; desc: boolean }>>([]);
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize });
  const [pickerOpen, setPickerOpen] = useState(false);

  // Read on mount rather than during render: the server has no localStorage, and
  // a mismatch between the two passes is a hydration error.
  useEffect(() => setColumnVisibility(readVisibility(columnVisibilityKey)), [columnVisibilityKey]);

  useEffect(() => {
    if (!columnVisibilityKey || typeof window === "undefined") return;
    window.localStorage.setItem(`openboard:columns:${columnVisibilityKey}`, JSON.stringify(columnVisibility));
  }, [columnVisibility, columnVisibilityKey]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting, rowSelection, columnVisibility, pagination },
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
    enableRowSelection: enableSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    ...(getRowId ? { getRowId } : {}),
  });

  const pageCount = table.getPageCount();
  // A row leaving the filter must not strand the pager on a page that no longer
  // exists — the table would render empty while the data is fine.
  useEffect(() => {
    if (pageCount > 0 && pagination.pageIndex > pageCount - 1) {
      setPagination((current) => ({ ...current, pageIndex: pageCount - 1 }));
    }
  }, [pageCount, pagination.pageIndex]);

  const selectedRows = useMemo(
    () => table.getSelectedRowModel().rows.map((row) => row.original),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selection identity is what changed
    [rowSelection, data],
  );
  useEffect(() => onSelectionChange?.(selectedRows), [selectedRows, onSelectionChange]);

  const rows = table.getRowModel().rows;
  const hideable = table.getAllLeafColumns().filter((column) => column.getCanHide() && column.id !== "select");

  return (
    <section className="data-panel">
      {(toolbar || columnVisibilityKey) && (
        <div className="data-toolbar">
          {toolbar}
          {columnVisibilityKey && (
            <div className="row-count" style={{ position: "relative" }}>
              <button type="button" className="filter-button" onClick={() => setPickerOpen((open) => !open)} aria-expanded={pickerOpen}>
                <Columns3 size={14} /> Columns
              </button>
              {pickerOpen && (
                <div className="column-picker" role="group" aria-label="Toggle columns">
                  {hideable.map((column) => (
                    <label key={column.id}>
                      <input
                        type="checkbox"
                        checked={column.getIsVisible()}
                        onChange={(event) => column.toggleVisibility(event.target.checked)}
                      />
                      {String(column.columnDef.header ?? column.id)}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {enableSelection && selectedRows.length > 0 && (
        <div className="bulk-bar">
          <span>{selectedRows.length} selected on this page</span>
          <button type="button" onClick={() => setRowSelection({})}>Clear</button>
        </div>
      )}

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {enableSelection && (
                  <th style={{ width: 38 }}>
                    <input
                      type="checkbox"
                      aria-label="Select every row on this page"
                      checked={table.getIsAllPageRowsSelected()}
                      ref={(node) => { if (node) node.indeterminate = table.getIsSomePageRowsSelected() && !table.getIsAllPageRowsSelected(); }}
                      onChange={table.getToggleAllPageRowsSelectedHandler()}
                    />
                  </th>
                )}
                {group.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  return (
                    <th key={header.id} aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"}>
                      {header.isPlaceholder ? null : header.column.getCanSort() ? (
                        <button type="button" className="table-sort" onClick={header.column.getToggleSortingHandler()}>
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sorted === "asc" ? <ChevronUp size={12} /> : sorted === "desc" ? <ChevronDown size={12} /> : null}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {isLoading
              ? Array.from({ length: 5 }, (_, index) => (
                <tr key={`skeleton-${index}`} className="skeleton-row">
                  <td colSpan={table.getVisibleLeafColumns().length + (enableSelection ? 1 : 0)}><span /></td>
                </tr>
              ))
              : rows.map((row) => (
                <tr
                  key={row.id}
                  className={row.getIsSelected() ? "selected" : undefined}
                  {...(onRowClick ? { onClick: () => onRowClick(row.original) } : {})}
                >
                  {enableSelection && (
                    <td onClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label="Select row"
                        checked={row.getIsSelected()}
                        onChange={row.getToggleSelectedHandler()}
                      />
                    </td>
                  )}
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {!isLoading && rows.length === 0 && empty}

      {pageCount > 1 && (
        <div className="table-footer">
          <span>Page {pagination.pageIndex + 1} of {pageCount}</span>
          <div>
            <button type="button" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>Previous</button>
            <button type="button" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>Next</button>
          </div>
        </div>
      )}
    </section>
  );
}
