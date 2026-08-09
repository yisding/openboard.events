"use client";

import { Inbox } from "lucide-react";
import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { formatCode } from "@/features/submissions";
import type { SubmissionListRow, SubmissionStatus } from "@/shared/contracts";
import { ColorChip } from "@/shared/ui/app/color-chip";
import { DataTable, nullsLast } from "@/shared/ui/app/data-table";
import { Dash } from "@/shared/ui/app/dash";
import { TzTime } from "@/shared/ui/app/tz-time";
import { Button, EmptyState, StatusBadge } from "@/shared/ui/ui-kit";

/**
 * The Abstracts table over database rows. Counts arrive from the server
 * alongside the rows, computed from the same filter — a tab that disagrees with
 * the table under it is the bug this shape exists to prevent.
 */
const TABS: Array<{ id: SubmissionStatus | "all"; label: string }> = [
  { id: "all", label: "All" },
  { id: "pending", label: "Pending" },
  { id: "accept_queue", label: "Accept queue" },
  { id: "accepted", label: "Accepted" },
  { id: "declined", label: "Declined" },
  { id: "draft", label: "Drafts" },
];

export function AbstractsTable({
  rows,
  counts,
  status,
  search,
  timezone,
  total,
  onFilter,
}: {
  rows: SubmissionListRow[];
  counts: Record<SubmissionStatus | "all", number>;
  status: SubmissionStatus | "all";
  search: string;
  timezone: string;
  total: number;
  onFilter: (next: { status?: SubmissionStatus | "all"; search?: string }) => void;
}) {
  const [draftSearch, setDraftSearch] = useState(search);

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
      cell: ({ row }) => (
        <div className="submission-title-cell">
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
      sortingFn: nullsLast,
      cell: ({ row }) => <Dash value={row.original.speakers[0]?.name}>
        <span>{row.original.speakers.map((speaker) => speaker.name).join(", ")}</span>
      </Dash>,
    },
    { id: "status", header: "Status", accessorKey: "status", cell: ({ row }) => <StatusBadge value={row.original.status} /> },
    {
      id: "track",
      header: "Track",
      accessorFn: (row) => row.trackName,
      sortingFn: nullsLast,
      cell: ({ row }) => row.original.trackName
        ? <ColorChip label={row.original.trackName} color={row.original.trackColor} />
        : <Dash />,
    },
    {
      id: "rating",
      header: "Rating",
      accessorFn: (row) => row.rating,
      sortingFn: nullsLast,
      cell: ({ row }) => <Dash value={row.original.rating}>
        <span className="rating">{row.original.rating?.toFixed(1)} <small>({row.original.nScores})</small></span>
      </Dash>,
    },
    {
      id: "submitted",
      header: "Submitted",
      accessorFn: (row) => row.submittedAt,
      sortingFn: nullsLast,
      cell: ({ row }) => <TzTime instant={row.original.submittedAt} tz={timezone} style="date" secondary="time" />,
    },
  ], [timezone]);

  return (
    <>
      <div className="abstract-status-tabs" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={status === tab.id}
            className={status === tab.id ? "active" : ""}
            onClick={() => onFilter({ status: tab.id })}
          >
            {tab.label} <span>{counts[tab.id]}</span>
          </button>
        ))}
      </div>

      <DataTable
        columns={columns}
        data={rows}
        columnVisibilityKey="abstracts"
        getRowId={(row) => row.submissionId}
        toolbar={
          <form
            className="table-search"
            onSubmit={(event) => { event.preventDefault(); onFilter({ search: draftSearch }); }}
          >
            <input
              value={draftSearch}
              onChange={(event) => setDraftSearch(event.target.value)}
              placeholder="Search code, title or speaker"
              aria-label="Search abstracts"
            />
          </form>
        }
        empty={
          <EmptyState
            icon={<Inbox size={20} />}
            title={search ? "Nothing matches that search" : "No abstracts yet"}
            description={search
              ? `${total} submission${total === 1 ? "" : "s"} exist in total — clear the search to see them.`
              : "Submissions appear here as speakers complete the CFP form."}
            {...(search ? { action: <Button onClick={() => { setDraftSearch(""); onFilter({ search: "" }); }}>Clear search</Button> } : {})}
          />
        }
      />
    </>
  );
}
