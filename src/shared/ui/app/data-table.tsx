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
  type RowData,
  type SortingState,
  type Updater,
  type VisibilityState,
} from "@tanstack/react-table";
import { ChevronDown, ChevronUp, Columns3 } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Dash } from "./dash";
import { BulkActionBar } from "./bulk-action-bar";

// Additive column-meta support: a column definition may carry a stable class
// name that DataTable stamps onto both its <th> and every <td> in that
// column. This exists for responsive column-hiding — nth-child selectors
// break the moment a table's column order differs from the surface that was
// screenshotted, which is exactly what happened with the demo `.abstracts-table`
// vs. the database-backed one (same feature, different column order, only the
// shared `class="data-table"` in common). A per-column class survives that.
declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Stamped onto this column's <th> and every <td> in its body cells. */
    className?: string;
  }
}

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
 * Selection is **page-local by default**: selecting all selects the rows you
 * can see, which is what the bulk bar's count means and what the decision
 * mutations expect. A caller that already owns the complete filtered data may
 * opt into a bounded all-row scope; the default and server-paginated paths do
 * not change.
 */
export type DataTableSelectionScope = "page" | "allRows";

export type DataTableAllRowsSelection = {
  maxRows: number;
  singularNoun: string;
  pluralNoun: string;
};

export type DataTableSelectionContext<Row> = {
  selectedRows: Row[];
  countLabel: string;
  clearSelection: () => void;
  scope: DataTableSelectionScope;
  pageSelectedCount: number;
  pageRowCount: number;
  totalRowCount: number;
  /** Present only while the caller's complete local row set is within its cap. */
  selectAllRows?: () => void;
};

export type DataTableProps<Row> = {
  columns: Array<ColumnDef<Row, unknown>>;
  data: Row[];
  /** Required. Rendered only after loading, when there is nothing to show. */
  empty: ReactNode;
  isLoading?: boolean;
  toolbar?: ReactNode;
  enableSelection?: boolean;
  /** Limits selection without hiding rows; ineligible rows render disabled controls. */
  isRowSelectable?: (row: Row) => boolean;
  /** Human-readable identity used by that row's selection checkbox. */
  getRowLabel?: (row: Row) => string;
  onSelectionChange?: (rows: Row[]) => void;
  /** Replaces the default count-only selection bar at its canonical location. */
  renderSelectionBar?: (selection: DataTableSelectionContext<Row>) => ReactNode;
  /**
   * Opt into retaining selection across local pages and exposing
   * `selectAllRows`. Above `maxRows`, behavior falls back to the default
   * page-local scope. Never use this for a server-paginated partial row set.
   */
  allRowsSelection?: DataTableAllRowsSelection;
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

export function dataTableCanSelectAllRows(
  rowCount: number,
  allRowsSelection?: DataTableAllRowsSelection,
): boolean {
  if (!allRowsSelection) return false;
  const { maxRows } = allRowsSelection;
  return Number.isInteger(maxRows) && maxRows > 0 && rowCount > 0 && rowCount <= maxRows;
}

function selectionNoun(count: number, wording: DataTableAllRowsSelection): string {
  return count === 1 ? wording.singularNoun : wording.pluralNoun;
}

export function dataTableSelectionCountLabel(
  count: number,
  scope: DataTableSelectionScope,
  wording?: DataTableAllRowsSelection,
): string {
  if (!wording) return `${count} selected on this page`;
  const noun = selectionNoun(count, wording);
  return scope === "allRows"
    ? `${count} matching ${noun} selected`
    : `${count} ${noun} selected on this page`;
}

export function selectionAnnouncement(
  previousCount: number,
  count: number,
  scope: DataTableSelectionScope = "page",
  wording?: DataTableAllRowsSelection,
): string | null {
  if (previousCount === count) return null;
  if (count === 0) return previousCount > 0 ? "Selection cleared." : null;
  if (wording) return `${dataTableSelectionCountLabel(count, scope, wording)}.`;
  return `${count} row${count === 1 ? "" : "s"} selected on this page.`;
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
  isRowSelectable,
  getRowLabel,
  onSelectionChange,
  renderSelectionBar,
  allRowsSelection,
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
  const [activeSelectionScope, setActiveSelectionScope] = useState<DataTableSelectionScope>("page");
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [localPagination, setLocalPagination] = useState<PaginationState>({ pageIndex: 0, pageSize });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectionStatus, setSelectionStatus] = useState("");
  const previousSelectionCount = useRef(0);
  const pickerId = useId();
  const pickerButtonId = `${pickerId}-button`;
  const pickerPanelId = `${pickerId}-panel`;
  const pickerButtonRef = useRef<HTMLButtonElement>(null);
  const pickerPanelRef = useRef<HTMLDivElement>(null);
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
    onRowSelectionChange: (updater) => {
      // A manual checkbox interaction means exactly the visible page again.
      // An all-row scope is entered only through the explicit escalation.
      setActiveSelectionScope("page");
      setRowSelection(updater);
    },
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: updatePagination,
    enableRowSelection: enableSelection
      ? (row) => isRowSelectable?.(row.original) ?? true
      : false,
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
    if (selectionEpoch === undefined) return;
    setActiveSelectionScope("page");
    setRowSelection({});
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
  const allRows = table.getPrePaginationRowModel().rows;
  const previousDataRef = useRef(data);
  const dataChanged = previousDataRef.current !== data;
  const canSelectAllRows = !serverPagination
    && !dataChanged
    && dataTableCanSelectAllRows(allRows.length, allRowsSelection);
  const selectionScope = activeSelectionScope === "allRows" && canSelectAllRows ? "allRows" : "page";
  const selectionRows = selectionScope === "allRows" ? allRows : rows;
  useEffect(() => {
    if (canSelectAllRows || activeSelectionScope === "page") return;
    setActiveSelectionScope("page");
  }, [activeSelectionScope, canSelectAllRows]);
  useEffect(() => {
    if (previousDataRef.current === data) return;
    previousDataRef.current = data;
    setActiveSelectionScope("page");
    setRowSelection({});
  }, [data]);
  // Page-local remains the default. An explicitly bounded all-row caller uses
  // the complete pre-pagination model instead, so its selected ids survive a
  // local page change but are still pruned as soon as data/filter eligibility
  // removes them.
  useEffect(() => {
    const visibleIds = new Set(selectionRows.filter((row) => row.getCanSelect()).map((row) => row.id));
    setRowSelection((current) => {
      const visible = Object.fromEntries(Object.entries(current).filter(([id]) => visibleIds.has(id)));
      return Object.keys(visible).length === Object.keys(current).length ? current : visible;
    });
  }, [selectionRows]);

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
    setActiveSelectionScope("page");
    const next: Record<string, boolean> = {};
    for (const row of rowsRef.current) {
      if (row.getCanSelect()) next[row.id] = true;
    }
    setRowSelection(next);
  }, [selectAllEpoch]);

  const selectedIds = useMemo(
    () => new Set(Object.entries(rowSelection).filter(([, selected]) => selected).map(([id]) => id)),
    [rowSelection],
  );
  const selectedRows = useMemo(
    () => selectionRows.filter((row) => selectedIds.has(row.id)).map((row) => row.original),
    [selectionRows, selectedIds],
  );
  const pageSelectedCount = rows.filter((row) => selectedIds.has(row.id)).length;
  const countLabel = dataTableSelectionCountLabel(selectedRows.length, selectionScope, allRowsSelection);
  const clearSelection = () => {
    setActiveSelectionScope("page");
    setRowSelection({});
  };
  // A ref, not a dependency, for the same reason as `rowsRef` above: a caller
  // that passes an inline arrow gets a fresh identity on every one of its
  // renders, so keeping the callback in the dep array would re-notify "the
  // selection changed" when it did not — stomping any state the caller set from
  // its own bulk bar (M-fix: the agenda confirm dialog was cleared on the very
  // render that opened it).
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;
  useEffect(() => onSelectionChangeRef.current?.(selectedRows), [selectedRows]);
  useEffect(() => {
    const next = selectionAnnouncement(
      previousSelectionCount.current,
      selectedRows.length,
      selectionScope,
      allRowsSelection,
    );
    previousSelectionCount.current = selectedRows.length;
    if (next) setSelectionStatus(next);
  }, [allRowsSelection, selectedRows.length, selectionScope]);

  useEffect(() => {
    if (!pickerOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      const active = document.activeElement;
      if (!(active instanceof Node)) return;
      if (!pickerButtonRef.current?.contains(active) && !pickerPanelRef.current?.contains(active)) return;
      event.preventDefault();
      setPickerOpen(false);
      window.requestAnimationFrame(() => pickerButtonRef.current?.focus());
    }
    function closeOutside(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (pickerButtonRef.current?.contains(target) || pickerPanelRef.current?.contains(target)) return;
      setPickerOpen(false);
    }
    function closeOnFocusOutside(event: FocusEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (pickerButtonRef.current?.contains(target) || pickerPanelRef.current?.contains(target)) return;
      setPickerOpen(false);
    }
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("focusin", closeOnFocusOutside);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("focusin", closeOnFocusOutside);
    };
  }, [pickerOpen]);

  const hideable = table.getAllLeafColumns().filter((column) => column.getCanHide() && column.id !== "select");

  return (
    <section className="data-panel">
      <p className="sr-only" role="status">{isLoading ? "Loading table data…" : ""}</p>
      <p className="sr-only" aria-live="polite" aria-atomic="true">{selectionStatus}</p>

      {(toolbar || columnVisibilityKey) && (
        <div className="data-toolbar">
          {toolbar}
          {columnVisibilityKey && (
            <div className="row-count" style={{ position: "relative" }}>
              <button
                ref={pickerButtonRef}
                id={pickerButtonId}
                type="button"
                className="filter-button"
                aria-expanded={pickerOpen}
                aria-controls={pickerOpen ? pickerPanelId : undefined}
                onClick={(event) => {
                  if (!pickerOpen) event.currentTarget.focus();
                  setPickerOpen((open) => !open);
                }}
              >
                <Columns3 size={14} /> Columns
              </button>
              {pickerOpen && (
                <div
                  ref={pickerPanelRef}
                  id={pickerPanelId}
                  className="column-picker"
                  role="group"
                  aria-labelledby={pickerButtonId}
                >
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

      {enableSelection && (renderSelectionBar
        ? renderSelectionBar({
            selectedRows,
            countLabel,
            clearSelection,
            scope: selectionScope,
            pageSelectedCount,
            pageRowCount: rows.length,
            totalRowCount: allRows.length,
            ...(canSelectAllRows
              ? {
                  selectAllRows: () => {
                    const next: Record<string, boolean> = {};
                    for (const row of allRows) {
                      if (row.getCanSelect()) next[row.id] = true;
                    }
                    setActiveSelectionScope("allRows");
                    setRowSelection(next);
                  },
                }
              : {}),
          })
        : <BulkActionBar
            count={selectedRows.length}
            countLabel={countLabel}
            onClear={clearSelection}
          />)}

      <div className="table-scroll" aria-busy={isLoading}>
        <table className="data-table">
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {enableSelection && (
                  <th style={{ width: 44 }}>
                    {/* `.checkbox-hit` carries the 44x44 touch target the bare
                        14px control cannot — padding does not grow a native
                        checkbox. The label toggles it with no extra handler. */}
                    <label className="checkbox-hit">
                      <input
                        type="checkbox"
                        aria-label="Select every row on this page"
                        checked={table.getIsAllPageRowsSelected()}
                        disabled={!table.getRowModel().rows.some((row) => row.getCanSelect())}
                        ref={(node) => { if (node) node.indeterminate = table.getIsSomePageRowsSelected() && !table.getIsAllPageRowsSelected(); }}
                        onChange={table.getToggleAllPageRowsSelectedHandler()}
                      />
                    </label>
                  </th>
                )}
                {group.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      {...(header.column.columnDef.meta?.className ? { className: header.column.columnDef.meta.className } : {})}
                      aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"}
                    >
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
                        onKeyDown: (event: ReactKeyboardEvent<HTMLTableRowElement>) => {
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
                      {/* `.checkbox-hit` carries the 44x44 touch target the bare
                          native checkbox cannot (T7); the name comes from
                          `getRowLabel` so each row reads distinctly. */}
                      <label className="checkbox-hit">
                        <input
                          type="checkbox"
                          aria-label={selectionLabel(row.original, row.id, getRowLabel)}
                          checked={row.getIsSelected()}
                          disabled={!row.getCanSelect()}
                          onChange={row.getToggleSelectedHandler()}
                        />
                      </label>
                    </td>
                  )}
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      {...(cell.column.columnDef.meta?.className ? { className: cell.column.columnDef.meta.className } : {})}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
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
