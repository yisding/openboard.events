"use client";

import { Plus } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import type { SubmissionFilters, SubmissionVocabulary } from "@/features/submissions";
import type { SubmissionListRow, SubmissionStatus } from "@/shared/contracts";
import { Button, PageHeader } from "@/shared/ui/ui-kit";
import { AbstractsTable } from "./abstracts-table";
import { AddAbstractDrawer } from "./add-abstract-drawer";
import { DecisionBar } from "./decision-bar";
import { SubmissionDrawer } from "./submission-drawer";

/**
 * Filters live in the URL, not in component state: an organizer who has narrowed
 * to "Accept queue, search 'agents'" can send that link to a colleague, and the
 * back button does what it looks like it does.
 */
export function AbstractsView({
  eventId,
  rows,
  counts,
  status,
  search,
  timezone,
  total,
  filteredTotal,
  page,
  pageSize,
  sort,
  queued,
  vocabulary,
  canEdit,
}: {
  eventId: string;
  rows: SubmissionListRow[];
  counts: Record<SubmissionStatus | "all", number>;
  status: SubmissionStatus | "all";
  search: string;
  timezone: string;
  /** Event-wide total, excluding the active search and status. */
  total: number;
  /** Total matching the active filters, including status. */
  filteredTotal: number;
  page: number;
  pageSize: number;
  sort: SubmissionFilters["sort"];
  /** Event-wide, because Notify is event-wide. */
  queued: number;
  /** This event's tracks, formats and tags — what the two editors offer. */
  vocabulary: SubmissionVocabulary;
  /** Reviewers read the same table; only an organizer may change a row. */
  canEdit: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [selected, setSelected] = useState<SubmissionListRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // Bumped to clear the table's own checkbox state; `selected` is only a mirror
  // of it, so resetting the mirror alone leaves the boxes ticked.
  const [selectionEpoch, setSelectionEpoch] = useState(0);

  const clearSelection = useCallback(() => {
    setSelected([]);
    setSelectionEpoch((epoch) => epoch + 1);
  }, []);

  const onFilter = useCallback((next: { status?: SubmissionStatus | "all"; search?: string }) => {
    const query = new URLSearchParams(params.toString());
    if (next.status !== undefined) query.set("status", next.status);
    if (next.search !== undefined) {
      if (next.search) query.set("search", next.search);
      else query.delete("search");
    }
    // A filter change resets the page; page 4 of a narrower result set is empty.
    query.delete("page");
    router.push(`?${query.toString()}`);
  }, [params, router]);

  const onPageChange = useCallback((page: number) => {
    const query = new URLSearchParams(params.toString());
    if (page > 1) query.set("page", String(page));
    else query.delete("page");
    router.push(`?${query.toString()}`);
  }, [params, router]);

  const onSortChange = useCallback((next: SubmissionFilters["sort"]) => {
    const query = new URLSearchParams(params.toString());
    if (next === "newest") query.delete("sort");
    else query.set("sort", next);
    // A new global order starts on its first server page.
    query.delete("page");
    router.push(`?${query.toString()}`);
  }, [params, router]);

  // Same filters, same search, same sort as the table on screen — the export
  // route walks every page server-side, so the query string it needs is
  // exactly the one already in the address bar.
  const exportHref = `/api/internal/submissions/${eventId}/export.csv?${params.toString()}`;

  return (
    <main className="page">
      <PageHeader
        eyebrow="PROGRAM"
        title="Abstracts"
        description="Every proposal for this event, with its status, track and rating."
        actions={
          <>
            <a className="button button-secondary" href={exportHref} download>Export .CSV</a>
            {canEdit && <Button onClick={() => setAdding(true)}><Plus size={16} /> Add abstract</Button>}
          </>
        }
      />
      <DecisionBar
        eventId={eventId}
        selected={selected}
        pendingNotify={queued}
        onDone={clearSelection}
      />
      <AbstractsTable
        rows={rows}
        counts={counts}
        status={status}
        search={search}
        timezone={timezone}
        total={total}
        filteredTotal={filteredTotal}
        page={page}
        pageSize={pageSize}
        sort={sort}
        onFilter={onFilter}
        onPageChange={onPageChange}
        onSortChange={onSortChange}
        selectionEpoch={selectionEpoch}
        onSelectionChange={setSelected}
        onRowClick={(row) => setOpenId(row.submissionId)}
      />
      {openId && (
        <SubmissionDrawer
          eventId={eventId}
          submissionId={openId}
          timezone={timezone}
          vocabulary={vocabulary}
          canEdit={canEdit}
          onClose={() => setOpenId(null)}
        />
      )}
      {canEdit && (
        <AddAbstractDrawer
          eventId={eventId}
          vocabulary={vocabulary}
          timezone={timezone}
          open={adding}
          onClose={() => setAdding(false)}
        />
      )}
    </main>
  );
}
