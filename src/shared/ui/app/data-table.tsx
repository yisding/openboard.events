"use client";

import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type PaginationState,
  type Row as TableRow,
  type SortingState,
  type Updater,
  type VisibilityState,
} from "@tanstack/react-table";
import { ChevronDown, ChevronUp, Columns3 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Dash } from "./dash";

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
 *   getRowLabel={(row) => `${row.code}, ${row.title}`}
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
  /** Human-readable identity used by that row's selection checkbox. */
  getRowLabel?: (row: Row) => string;
  onSelectionChange?: (rows: Row[]) => void;
  /** localStorage key for hidden columns. Scope it per event. */
  columnVisibilityKey?: string;
  onRowClick?: (row: Row) => void;
  pageSize?: number;
  /** Stable row identity; defaults to `row.id` when present. */
  getRowId?: (row: Row, index: number) => string;
  /** Change this to clear the selection — the table owns that state, not the caller. */
  selectionEpoch?: number;
  /**
   * M58 — change this to select every row currently on screen (page-local,
   * same rule as manual selection). The command palette's verb entries use
   * this to open a list "pre-armed": the bulk bar is already showing a count
   * and its action buttons, nothing left to click but the verb itself.
   */
  selectAllEpoch?: number;
  /**
   * Opt into server pagination when `data` is already one page. Other tables
   * retain the local pagination behavior by leaving this absent.
   */
  serverPagination?: {
    page: number;
    pageSize: number;
    total: number;
    onPageChange: (page: number) => void;
  };
  /** Opt into server sorting when the query, rather than this page, orders rows. */
  serverSorting?: {
    state: SortingState;
    onChange: (state: SortingState) => void;
  };
};

/**
 * Nulls sort last in *both* directions. The Rating column is the reason: a
 * default comparator puts unreviewed submissions first on one click and last on
 * the other, so "sort by rating" never shows the best proposals.
 */
export function nullsLast<TData>(
  rowA: TableRow<TData>,
  rowB: TableRow<TData>,
  columnId: string,
  descending = false,
): number {
  const a = rowA.getValue(columnId);
  const b = rowB.getValue(columnId);
  const aEmpty = a === null || a === undefined || a === "";
  const bEmpty = b === null || b === undefined || b === "";
  if (aEmpty && bEmpty) return 0;
  // TanStack reverses the comparator for descending sorts. Pre-flip only the
  // empty-value verdict so that its reversal still leaves empties at the end;
  // populated values keep the normal direction reversal.
  if (aEmpty) return descending ? -1 : 1;
  if (bEmpty) return descending ? 1 : -1;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

export function defaultRowId<Row>(row: Row, index: number): string {
  if (typeof row === "object" && row !== null && "id" in row) {
    const id = (row as { id?: unknown }).id;
    if (id !== null && id !== undefined) return String(id);
  }
  return String(index);
}

export function selectionLabel<Row>(row: Row, rowId: string, getRowLabel?: (row: Row) => string): string {
  const label = getRowLabel?.(row).trim();
  return `Select ${label || `row ${rowId}`}`;
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
  getRowLabel,
  onSelectionChange,
  columnVisibilityKey,
  onRowClick,
  pageSize = 25,
  getRowId,
  selectionEpoch,
  selectAllEpoch,
  serverPagination,
  serverSorting,
}: DataTableProps<Row>) {
  const [localSorting, setLocalSorting] = useState<SortingState>([]);
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [localPagination, setLocalPagination] = useState<PaginationState>({ pageIndex: 0, pageSize });
  const [pickerOpen, setPickerOpen] = useState(false);
  const sorting = serverSorting?.state ?? localSorting;
  const pagination = serverPagination
    ? { pageIndex: Math.max(0, serverPagination.page - 1), pageSize: serverPagination.pageSize }
    : localPagination;
  const requestServerPage = serverPagination?.onPageChange;

  const updateSorting = (updater: Updater<SortingState>) => {
    const next = typeof updater === "function" ? updater(sorting) : updater;
    if (serverSorting) serverSorting.onChange(next);
    else setLocalSorting(next);
  };

  const updatePagination = (updater: Updater<PaginationState>) => {
    const next = typeof updater === "function" ? updater(pagination) : updater;
    if (requestServerPage) {
      if (next.pageIndex !== pagination.pageIndex) requestServerPage(next.pageIndex + 1);
    } else {
      setLocalPagination(next);
    }
  };

  // Read on mount rather than during render: the server has no localStorage, and
  // a mismatch between the two passes is a hydration error.
  useEffect(() => setColumnVisibility(readVisibility(columnVisibilityKey)), [columnVisibilityKey]);

  useEffect(() => {
    if (!columnVisibilityKey || typeof window === "undefined") return;
    window.localStorage.setItem(`openboard:columns:${columnVisibilityKey}`, JSON.stringify(columnVisibility));
  }, [columnVisibility, columnVisibilityKey]);

  const directionAwareColumns = useMemo(
    () => columns.map((column) => column.sortingFn === nullsLast
      ? {
          ...column,
          sortingFn: (rowA: TableRow<Row>, rowB: TableRow<Row>, columnId: string) => nullsLast(
            rowA,
            rowB,
            columnId,
            sorting.some((entry) => entry.id === columnId && entry.desc),
          ),
        }
      : column),
    [columns, sorting],
  );

  const table = useReactTable({
    data,
    columns: directionAwareColumns,
    defaultColumn: {
      cell: ({ getValue }) => <Dash value={getValue()} />,
    },
    state: { sorting, rowSelection, columnVisibility, pagination },
    onSortingChange: updateSorting,
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: updatePagination,
    enableRowSelection: enableSelection,
    manualSorting: Boolean(serverSorting),
    manualPagination: Boolean(serverPagination),
    ...(serverPagination
      ? { pageCount: Math.ceil(serverPagination.total / serverPagination.pageSize) }
      : {}),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getRowId: getRowId ?? defaultRowId,
  });

  useEffect(() => {
    if (selectionEpoch !== undefined) setRowSelection({});
  }, [selectionEpoch]);

  const pageCount = table.getPageCount();
  // A row leaving the filter must not strand the pager on a page that no longer
  // exists — the table would render empty while the data is fine.
  useEffect(() => {
    if (pageCount > 0 && pagination.pageIndex > pageCount - 1) {
      if (requestServerPage) requestServerPage(pageCount);
      else setLocalPagination((current) => ({ ...current, pageIndex: pageCount - 1 }));
    }
  }, [pageCount, pagination.pageIndex, requestServerPage]);

  const rows = table.getRowModel().rows;
  // Page-local means hidden selections do not merely disappear from the count:
  // changing page/filter discards their keys so returning cannot resurrect them.
  useEffect(() => {
    const visibleIds = new Set(rows.map((row) => row.id));
    setRowSelection((current) => {
      const visible = Object.fromEntries(Object.entries(current).filter(([id]) => visibleIds.has(id)));
      return Object.keys(visible).length === Object.keys(current).length ? current : visible;
    });
  }, [rows]);

  // M58 — a ref, not a dependency: `selectAllEpoch` should select whatever is
  // on screen the moment it changes, not re-select on every later page/filter
  // change (that would fight a caller who deselects a row after arming).
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  // Fix (review P6): both call sites seed this with `useState(0)`, a defined
  // number, so an `=== undefined` guard fires on every mount, not only on a
  // real bump. Compare against the *previous* value instead — a ref that
  // starts equal to the current prop means the mount render is always a
  // no-op, and only a later change (0 -> 1, or undefined -> 1) selects rows.
  const previousSelectAllEpochRef = useRef(selectAllEpoch);
  useEffect(() => {
    if (selectAllEpoch === previousSelectAllEpochRef.current) return;
    previousSelectAllEpochRef.current = selectAllEpoch;
    if (selectAllEpoch === undefined) return;
    const next: Record<string, boolean> = {};
    for (const row of rowsRef.current) next[row.id] = true;
    setRowSelection(next);
  }, [selectAllEpoch]);

  const selectedIds = useMemo(
    () => new Set(Object.entries(rowSelection).filter(([, selected]) => selected).map(([id]) => id)),
    [rowSelection],
  );
  const selectedRows = useMemo(
    () => rows.filter((row) => selectedIds.has(row.id)).map((row) => row.original),
    [rows, selectedIds],
  );
  useEffect(() => onSelectionChange?.(selectedRows), [selectedRows, onSelectionChange]);

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
                  {...(onRowClick
                    ? {
                        onClick: () => onRowClick(row.original),
                        tabIndex: 0,
                        "aria-keyshortcuts": "Enter Space",
                        onKeyDown: (event: KeyboardEvent<HTMLTableRowElement>) => {
                          // Interactive descendants own their keys; only a
                          // directly focused row invokes the row action.
                          if (event.target !== event.currentTarget) return;
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onRowClick(row.original);
                          }
                        },
                      }
                    : {})}
                >
                  {enableSelection && (
                    <td onClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={selectionLabel(row.original, row.id, getRowLabel)}
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
