"use client";

import { Inbox } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { formatCode } from "@/features/submissions/index.client";
import type { SubmissionFilters, SubmissionView } from "@/features/submissions";
import type { SubmissionListRow, SubmissionStatus } from "@/shared/contracts";
import { ColorChip } from "@/shared/ui/app/color-chip";
import { DataTable, nullsLast, type DataTableProps } from "@/shared/ui/app/data-table";
import { Dash } from "@/shared/ui/app/dash";
import { TzTime } from "@/shared/ui/app/tz-time";
import { statusBadgeLabel } from "@/shared/ui/status-badge";
import { Button, EmptyState, StatusBadge } from "@/shared/ui/ui-kit";

/**
 * The Abstracts table over database rows. Counts arrive from the server
 * alongside the rows, computed from the same filter — a tab that disagrees with
 * the table under it is the bug this shape exists to prevent.
 */
export function abstractWorkflowTabs(counts: Record<SubmissionStatus | "all", number>) {
  return [
    { id: "needs_decision", label: "Needs decision", count: counts.pending },
    {
      id: "ready_to_notify",
      label: "Ready to notify",
      count: counts.accept_queue + counts.decline_queue,
      acceptCount: counts.accept_queue,
      declineCount: counts.decline_queue,
    },
    { id: "decided", label: "Decided", count: counts.accepted + counts.declined + counts.withdrawn },
    { id: "all", label: "All", count: counts.all },
  ] satisfies Array<{
    id: SubmissionView;
    label: string;
    count: number;
    acceptCount?: number;
    declineCount?: number;
  }>;
}

const EXACT_STATUSES_BY_VIEW: Record<SubmissionView, SubmissionStatus[]> = {
  needs_decision: [],
  ready_to_notify: ["accept_queue", "decline_queue"],
  decided: ["accepted", "declined", "withdrawn"],
  all: ["draft"],
};

/**
 * An empty table has three different meanings and the organizer needs to know
 * which one: nothing matched the search, this stage of the workflow is simply
 * clear, or the event has genuinely never received a submission. Telling an
 * organizer with 24 submissions that there are none — and pointing them at the
 * CFP form — is the failure this map exists to prevent.
 */
const EMPTY_STATE_BY_VIEW: Record<SubmissionView, { title: string; description: string }> = {
  needs_decision: {
    title: "Nothing needs a decision",
    description: "New submissions land here for review as speakers send them.",
  },
  ready_to_notify: {
    title: "Nothing is queued for notification",
    description: "Stage decisions from Needs decision, then send them from here.",
  },
  decided: {
    title: "No decisions yet",
    description: "Accepted, declined and withdrawn submissions collect here.",
  },
  all: {
    title: "No submissions yet",
    description: "Publish a CFP form and share its link — submissions land here as speakers complete it.",
  },
};

const SORTING_BY_QUERY: Record<SubmissionFilters["sort"], SortingState[number]> = {
  newest: { id: "submitted", desc: true },
  oldest: { id: "submitted", desc: false },
  code: { id: "code", desc: false },
  code_desc: { id: "code", desc: true },
  title: { id: "title", desc: false },
  title_desc: { id: "title", desc: true },
  rating: { id: "rating", desc: true },
  rating_asc: { id: "rating", desc: false },
};

function submissionSortFromTable(state: SortingState): SubmissionFilters["sort"] {
  const [sort] = state;
  if (!sort) return "newest";
  if (sort.id === "submitted") return sort.desc ? "newest" : "oldest";
  if (sort.id === "code") return sort.desc ? "code_desc" : "code";
  if (sort.id === "title") return sort.desc ? "title_desc" : "title";
  if (sort.id === "rating") return sort.desc ? "rating" : "rating_asc";
  return "newest";
}

export function AbstractsTable({
  eventId,
  rows,
  counts,
  view,
  status,
  search,
  timezone,
  total,
  filteredTotal,
  page,
  pageSize,
  sort,
  onFilter,
  onPageChange,
  onSortChange,
  enableSelection,
  onSelectionChange,
  onRowClick,
  selectionEpoch,
  selectAllEpoch,
  renderSelectionBar,
}: {
  eventId: string;
  rows: SubmissionListRow[];
  counts: Record<SubmissionStatus | "all", number>;
  view: SubmissionView;
  status: SubmissionStatus | "all";
  search: string;
  timezone: string;
  /** Event-wide total used to explain an empty search result. */
  total: number;
  /** Active-filter total used by the server pager. */
  filteredTotal: number;
  page: number;
  pageSize: number;
  sort: SubmissionFilters["sort"];
  onFilter: (next: { view?: SubmissionView; status?: SubmissionStatus | "all"; search?: string }) => void;
  onPageChange: (page: number) => void;
  onSortChange: (sort: SubmissionFilters["sort"]) => void;
  /** Organizer-only bulk decisions; reviewers get the same readable rows without checkboxes. */
  enableSelection: boolean;
  onSelectionChange?: (rows: SubmissionListRow[]) => void;
  onRowClick?: (row: SubmissionListRow) => void;
  selectionEpoch?: number;
  /** M58 — bumped to select every row on screen, arming the bar from a palette verb. */
  selectAllEpoch?: number;
  renderSelectionBar?: DataTableProps<SubmissionListRow>["renderSelectionBar"];
}) {
  const [draftSearch, setDraftSearch] = useState(search);
  useEffect(() => setDraftSearch(search), [search]);
  const workflowTabs = abstractWorkflowTabs(counts);
  const activeWorkflow = workflowTabs.find((tab) => tab.id === view);
  const exactStatuses = EXACT_STATUSES_BY_VIEW[view];
  const exactStatusAllLabel = view === "all"
    ? "All submissions"
    : `All ${activeWorkflow?.label.toLowerCase() ?? "statuses"}`;

  // An event with no submissions at all reads as first-run whatever filter is
  // set; past that, the empty table has to name the filter that emptied it.
  const emptyState: { title: string; description: string; action?: ReactNode } = total === 0
    ? {
      ...EMPTY_STATE_BY_VIEW.all,
      // A brand-new event has nowhere to send speakers yet, so the first-run
      // state carries the route that fixes that rather than naming a form the
      // organizer has not built.
      action: <Link className="button button-primary" href={`/events/${eventId}/forms`}>Open forms</Link>,
    }
    : search
      ? {
        title: "Nothing matches that search",
        description: `${total} submission${total === 1 ? "" : "s"} exist in total — clear the search to see them.`,
        action: <Button onClick={() => { setDraftSearch(""); onFilter({ search: "" }); }}>Clear search</Button>,
      }
      : status !== "all"
        ? {
          title: "Nothing has that status",
          description: `No submission in this event is marked “${statusBadgeLabel(status)}” right now.`,
          action: <Button onClick={() => onFilter({ view, status: "all" })}>{exactStatusAllLabel}</Button>,
        }
        : EMPTY_STATE_BY_VIEW[view];

  const columns = useMemo<Array<ColumnDef<SubmissionListRow, unknown>>>(() => [
    {
      id: "code",
      header: "Code",
      accessorKey: "code",
      cell: ({ row }) => <span className="submission-code">{formatCode(row.original.code)}</span>,
    },
    {
      id: "title",
      header: "Title",
      accessorKey: "title",
      // `.data-table` is `table-layout:auto` and every other column is
      // `white-space:nowrap`, so auto layout satisfies them first and hands the
      // whole deficit to the one column that can wrap — this one, which also
      // carries the description. Without a width of its own it collapsed to
      // roughly its longest word (measured: 111px, in a 192px-tall row). The
      // class is the seam the stylesheet needs to give the column a floor. It is
      // deliberately outside the `abstracts-col-*` namespace: that one belongs
      // to the T5 responsive disclosure ladder, whose members are the columns
      // mobile hides, and Title is never one of them.
      meta: { className: "abstracts-title-column" },
      cell: ({ row }) => (
        // First Fair: the tour needs to point at the first proposal. The `<tr>`
        // belongs to the shared DataTable and the whole table sits behind a
        // QueryBoundary, so the lead row's title cell carries the anchor —
        // which is also the part of the row a spotlight should frame.
        <div className="submission-title-cell" {...(row.index === 0 ? { "data-tour": "abstracts.row" } : {})}>
          <b>{row.original.title}</b>
          <Dash value={row.original.descriptionPlain}>
            <span>{row.original.descriptionPlain?.slice(0, 120)}</span>
          </Dash>
        </div>
      ),
    },
    {
      id: "speakers",
      header: "Speakers",
      accessorFn: (row) => row.speakers[0]?.name ?? null,
      enableSorting: false,
      sortingFn: nullsLast,
      // T5 disclosure ladder (design-system.md) — this table has no demo
      // equivalent to ride nth-child off (the demo folds the speaker name
      // into the title cell instead), so it carries its own stable class.
      meta: { className: "abstracts-col-speakers" },
      cell: ({ row }) => <Dash value={row.original.speakers[0]?.name}>
        <span>{row.original.speakers.map((speaker) => speaker.name).join(", ")}</span>
      </Dash>,
    },
    { id: "status", header: "Status", accessorKey: "status", enableSorting: false, cell: ({ row }) => <StatusBadge value={row.original.status} /> },
    {
      id: "track",
      header: "Track",
      accessorFn: (row) => row.trackName,
      enableSorting: false,
      sortingFn: nullsLast,
      // Mirrors `.abstracts-table`'s Track column: ellipsised at ≤1024, hidden
      // at ≤768.
      meta: { className: "abstracts-col-track" },
      cell: ({ row }) => row.original.trackName
        ? <ColorChip label={row.original.trackName} />
        : <Dash />,
    },
    {
      id: "rating",
      header: "Rating",
      accessorFn: (row) => row.rating,
      sortDescFirst: true,
      sortingFn: nullsLast,
      cell: ({ row }) => <Dash value={row.original.rating}>
        <span className="rating">{row.original.rating?.toFixed(1)} <small>({row.original.nScores})</small></span>
      </Dash>,
    },
    {
      // M10 §4: the organizer has to be able to see, in the queue itself,
      // which decisions have already been sent. `notifiedAt` is set by the
      // notify run and cleared when a decision is undone, so an em dash here
      // means "this speaker has not been told".
      id: "notified",
      header: "Notified",
      accessorFn: (row) => row.notifiedAt,
      enableSorting: false,
      sortingFn: nullsLast,
      // T5 — the two lowest-priority columns (this and Submitted) hide first,
      // at ≤1024; the demo has no Notified column at all to model this on.
      meta: { className: "abstracts-col-notified" },
      cell: ({ row }) => <TzTime instant={row.original.notifiedAt} tz={timezone} style="date" secondary="time" />,
    },
    {
      id: "submitted",
      header: "Submitted",
      accessorFn: (row) => row.submittedAt,
      sortDescFirst: true,
      sortingFn: nullsLast,
      // Mirrors `.abstracts-table`'s Submitted column: hidden at ≤1024.
      meta: { className: "abstracts-col-submitted" },
      cell: ({ row }) => <TzTime instant={row.original.submittedAt} tz={timezone} style="date" secondary="time" />,
    },
  ], [timezone]);

  return (
    <>
      <div className="abstract-status-tabs" role="group" aria-label="Filter submissions by workflow">
        {workflowTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            aria-label={`${tab.label}, ${tab.count} ${tab.count === 1 ? "submission" : "submissions"}${tab.id === "ready_to_notify" ? `, ${tab.acceptCount} accept, ${tab.declineCount} decline` : ""}`}
            aria-pressed={view === tab.id}
            className={view === tab.id ? "active" : ""}
            onClick={() => onFilter({ view: tab.id, status: "all" })}
          >
            <b>{tab.label}</b> <span aria-hidden="true">{tab.count}</span>
            {tab.id === "ready_to_notify" && <small aria-hidden="true"><i>{tab.acceptCount} accept</i><i>{tab.declineCount} decline</i></small>}
          </button>
        ))}
      </div>
      {exactStatuses.length > 0 && (
        <div className="abstract-exact-status-filter" role="group" aria-label="Filter current workflow by exact status">
          <span>Exact status</span>
          <div>
            <button type="button" className={status === "all" ? "active" : ""} aria-pressed={status === "all"} onClick={() => onFilter({ view, status: "all" })}>
              {exactStatusAllLabel}
            </button>
            {exactStatuses.map((exactStatus) => (
              <button key={exactStatus} type="button" className={status === exactStatus ? "active" : ""} aria-pressed={status === exactStatus} onClick={() => onFilter({ status: exactStatus })}>
                <StatusBadge value={exactStatus} />
              </button>
            ))}
          </div>
        </div>
      )}

      <DataTable
        columns={columns}
        data={rows}
        enableSelection={enableSelection}
        getRowLabel={(row) => `${formatCode(row.code)}, ${row.title}`}
        {...(selectionEpoch === undefined ? {} : { selectionEpoch })}
        {...(selectAllEpoch === undefined ? {} : { selectAllEpoch })}
        columnVisibilityKey="abstracts"
        getRowId={(row) => row.submissionId}
        {...(onSelectionChange ? { onSelectionChange } : {})}
        {...(renderSelectionBar ? { renderSelectionBar } : {})}
        {...(onRowClick ? { onRowClick } : {})}
        serverPagination={{ page, pageSize, total: filteredTotal, onPageChange }}
        serverSorting={{
          state: [SORTING_BY_QUERY[sort]],
          onChange: (state) => onSortChange(submissionSortFromTable(state)),
        }}
        toolbar={
          <form
            className="table-search"
            onSubmit={(event) => { event.preventDefault(); onFilter({ search: draftSearch }); }}
          >
            <input
              value={draftSearch}
              onChange={(event) => setDraftSearch(event.target.value)}
              placeholder="Search code, title or speaker"
              aria-label="Search submissions"
            />
          </form>
        }
        empty={<EmptyState icon={<Inbox size={20} />} {...emptyState} />}
      />
    </>
  );
}
