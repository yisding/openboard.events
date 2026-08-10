"use client";

import { Search, Users, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import type { ContactFilters, ContactListRow } from "@/features/portal";
import type { ConfirmationStatus } from "@/shared/contracts";
import { CONFIRMATION_STATUSES } from "@/shared/contracts";
import { DataTable } from "@/shared/ui/app/data-table";
import { Dash } from "@/shared/ui/app/dash";
import { EmptyState, PageHeader, StatusBadge } from "@/shared/ui/ui-kit";
import { SpeakerHeadshot } from "./speaker-headshot";

type Sort = NonNullable<ContactFilters["sort"]>;
type Dir = NonNullable<ContactFilters["dir"]>;
type Missing = NonNullable<ContactFilters["missing"]>;

const SORT_TO_STATE: Record<Sort, string> = { name: "speaker", openTasks: "tasks", confirmation: "confirmation" };
const STATE_TO_SORT: Record<string, Sort> = { speaker: "name", tasks: "openTasks", confirmation: "confirmation" };

/** Two-initial fallback for a speaker with no usable headshot — never a broken image. */
function initialsFor(row: ContactListRow): string {
  const parts = row.name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
  if (parts.length === 1) return (parts[0] ?? "").slice(0, 2).toUpperCase();
  return row.email.slice(0, 2).toUpperCase();
}

/**
 * The Speakers admin table over real `contacts`/view rows (this module's
 * headline "moved off fixtures" change). Filters, sort and pagination all live
 * in the URL — `SPEAKERS_DEEPLINK_PARAMS` (M02 §9b) — so the dashboard's
 * missing-asset links and the browser back button both do what they look like
 * they do.
 */
export function SpeakersAdminView({
  eventId,
  rows,
  total,
  page,
  pageSize,
  q,
  accepted,
  missing,
  confirmation,
  sort,
  dir,
}: {
  eventId: string;
  rows: ContactListRow[];
  total: number;
  page: number;
  pageSize: number;
  q: string;
  accepted: boolean;
  missing: Missing | null;
  confirmation: ConfirmationStatus | null;
  sort: Sort;
  dir: Dir;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [draftSearch, setDraftSearch] = useState(q);
  useEffect(() => setDraftSearch(q), [q]);

  const setParams = (patch: Record<string, string | null>, resetPage = true) => {
    const query = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === "") query.delete(key);
      else query.set(key, value);
    }
    if (resetPage) query.delete("page");
    router.push(`?${query.toString()}`);
  };

  const columns = useMemo<Array<ColumnDef<ContactListRow, unknown>>>(() => [
    {
      id: "speaker",
      header: "Speaker",
      accessorKey: "name",
      cell: ({ row }) => (
        <div className="speaker-table-person">
          <SpeakerHeadshot name={row.original.name} initials={initialsFor(row.original)} headshotFileId={row.original.headshotFileId} />
          <div>
            <b>{row.original.name}</b>
            <span>{row.original.jobTitle ?? ""}{row.original.jobTitle && row.original.company ? " · " : ""}{row.original.company ?? ""}</span>
            <small>{row.original.email}</small>
          </div>
        </div>
      ),
    },
    {
      id: "confirmation",
      header: "Confirmation",
      accessorKey: "confirmationStatus",
      cell: ({ row }) => <StatusBadge value={row.original.confirmationStatus} />,
    },
    {
      id: "submissions",
      header: "Submissions",
      accessorKey: "submissionCount",
      enableSorting: false,
      cell: ({ row }) => <span className="session-count">{row.original.submissionCount}</span>,
    },
    {
      id: "tasks",
      header: "Tasks",
      accessorKey: "openTasks",
      cell: ({ row }) => {
        const { openTasks: open, overdueTasks: overdue } = row.original;
        if (open === 0 && overdue === 0) return <StatusBadge value="Ready" />;
        return <span>{open} open{overdue > 0 ? <> · <span style={{ color: "var(--red)" }}>{overdue} overdue</span></> : null}</span>;
      },
    },
    {
      id: "missing",
      header: "Missing",
      enableSorting: false,
      cell: ({ row }) => {
        const { missingBio, missingHeadshot } = row.original;
        if (!missingBio && !missingHeadshot) return <Dash />;
        return <div className="chip-picker">{missingBio && <span className="chip">Bio</span>}{missingHeadshot && <span className="chip">Headshot</span>}</div>;
      },
    },
  ], []);

  return (
    <main className="page">
      <PageHeader
        eyebrow="PEOPLE"
        title="Speakers"
        description="Every contact for this event, with confirmation, profile and onboarding status."
      />

      <div className="abstract-status-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={!accepted} className={!accepted ? "active" : ""} onClick={() => setParams({ accepted: null })}>All</button>
        <button type="button" role="tab" aria-selected={accepted} className={accepted ? "active" : ""} onClick={() => setParams({ accepted: accepted ? null : "1" })}>Accepted speakers</button>
        <button type="button" role="tab" aria-selected={missing === "bio"} className={missing === "bio" ? "active" : ""} onClick={() => setParams({ missing: missing === "bio" ? null : "bio" })}>Missing bio</button>
        <button type="button" role="tab" aria-selected={missing === "headshot"} className={missing === "headshot" ? "active" : ""} onClick={() => setParams({ missing: missing === "headshot" ? null : "headshot" })}>Missing headshot</button>
        <button type="button" role="tab" aria-selected={missing === "either"} className={missing === "either" ? "active" : ""} onClick={() => setParams({ missing: missing === "either" ? null : "either" })}>Missing bio or headshot</button>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        columnVisibilityKey={`speakers:${eventId}`}
        getRowId={(row) => row.contactId}
        onRowClick={(row) => router.push(`/events/${eventId}/speakers/${row.contactId}`)}
        serverPagination={{ page, pageSize, total, onPageChange: (next) => setParams({ page: next > 1 ? String(next) : null }, false) }}
        serverSorting={{
          state: [{ id: SORT_TO_STATE[sort], desc: dir === "desc" }],
          onChange: (state: SortingState) => {
            const [entry] = state;
            setParams({ sort: entry ? STATE_TO_SORT[entry.id] ?? "name" : null, dir: entry?.desc ? "desc" : null }, false);
          },
        }}
        toolbar={
          <>
            <form
              className="table-search"
              onSubmit={(event) => { event.preventDefault(); setParams({ q: draftSearch || null }); }}
            >
              <Search size={16} />
              <input
                value={draftSearch}
                onChange={(event) => setDraftSearch(event.target.value)}
                placeholder="Search name or email"
                aria-label="Search speakers"
              />
              {draftSearch && <button type="button" aria-label="Clear search" onClick={() => { setDraftSearch(""); setParams({ q: null }); }}><X size={14} /></button>}
            </form>
            <select
              className="compact-select"
              aria-label="Filter by confirmation"
              value={confirmation ?? "all"}
              onChange={(event) => setParams({ confirmation: event.target.value === "all" ? null : event.target.value })}
            >
              <option value="all">All confirmations</option>
              {CONFIRMATION_STATUSES.map((status) => <option key={status} value={status}>{status.charAt(0).toUpperCase()}{status.slice(1)}</option>)}
            </select>
            <span className="row-count">{total} shown</span>
          </>
        }
        empty={
          <EmptyState
            icon={<Users size={20} />}
            title={q || accepted || missing || confirmation ? "Nothing matches these filters" : "No speakers yet"}
            description={q || accepted || missing || confirmation ? "Try clearing a filter or search term." : "Contacts appear here once a proposal names them as a speaker."}
          />
        }
      />
    </main>
  );
}
