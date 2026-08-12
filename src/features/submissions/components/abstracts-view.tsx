"use client";

import { Plus } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { SubmissionFilters, SubmissionVocabulary } from "@/features/submissions";
import type { SubmissionListRow, SubmissionStatus } from "@/shared/contracts";
import { useGuardedAction } from "@/shared/ui/app/unsaved-work-guard";
import { useFlowKeyboardNav } from "@/shared/ui/app/use-flow-keyboard-nav";
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
  speakers,
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
  /** Every contact on the event, for Add abstract's speaker picker (#117). */
  speakers: Array<{ contactId: string; name: string }>;
  /** Reviewers read the same table; only an organizer may change a row. */
  canEdit: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const { runGuarded } = useGuardedAction();
  const [selected, setSelected] = useState<SubmissionListRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [drawerBusy, setDrawerBusy] = useState(false);
  // `?add=1` is how the agenda's "Add an invited talk" hands the organizer
  // straight to this drawer (#117), rather than dropping them on a table and
  // leaving them to find the button.
  const [adding, setAdding] = useState(() => params.get("add") === "1");
  // Bumped to clear the table's own checkbox state; `selected` is only a mirror
  // of it, so resetting the mirror alone leaves the boxes ticked.
  const [selectionEpoch, setSelectionEpoch] = useState(0);
  // M58 — bumped to select every row on screen: the command palette's
  // "pending abstracts" verb lands here with `?status=pending&arm=1` and the
  // bar is already showing "N selected" with its actions, nothing to click
  // first.
  const [selectAllEpoch, setSelectAllEpoch] = useState(0);

  const clearSelection = useCallback(() => {
    setSelected([]);
    setSelectionEpoch((epoch) => epoch + 1);
  }, []);

  // `arm` and `submission` are one-shot: consumed on arrival, then stripped
  // from the URL (replace, not push) so neither a re-render nor the back
  // button re-fires them. `submission` is the same param name
  // `SpeakerFlowDrawer`'s "this speaker's submissions" links already send —
  // that link was dead on this server-backed view until now; M58's command
  // palette entity jump reuses it rather than adding a second name for the
  // same thing.
  useEffect(() => {
    const shouldArm = params.get("arm") === "1";
    const openTarget = params.get("submission");
    if (!shouldArm && !openTarget) return;
    if (shouldArm) setSelectAllEpoch((epoch) => epoch + 1);
    if (openTarget) setOpenId(openTarget);
    const query = new URLSearchParams(params.toString());
    query.delete("arm");
    query.delete("submission");
    router.replace(`?${query.toString()}`, { scroll: false });
  }, [params, router]);

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

  // M57 — flow through the current server page with the keyboard: the ids
  // are this page's rows in the order the table is showing them, so
  // next/prev walks exactly what is on screen, not a hidden global order.
  const rowIds = useMemo<string[]>(() => rows.map((row) => row.submissionId), [rows]);
  const requestDrawerTarget = useCallback((submissionId: string | null) => {
    if (drawerBusy || submissionId === openId) return;
    runGuarded(() => setOpenId(submissionId));
  }, [drawerBusy, openId, runGuarded]);
  useFlowKeyboardNav({
    ids: rowIds,
    activeId: openId,
    onNavigate: requestDrawerTarget,
    onClose: () => requestDrawerTarget(null),
  });
  const openIndex = openId ? rowIds.indexOf(openId) : -1;

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
      {canEdit && (
        <DecisionBar
          eventId={eventId}
          selected={selected}
          pendingNotify={queued}
          onDone={clearSelection}
        />
      )}
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
        enableSelection={canEdit}
        selectionEpoch={selectionEpoch}
        selectAllEpoch={selectAllEpoch}
        {...(canEdit ? { onSelectionChange: setSelected } : {})}
        onRowClick={(row) => requestDrawerTarget(row.submissionId)}
      />
      {/* `openIndex === -1` happens when a command-palette jump opens a
          submission that is not on the current filtered/paginated page — the
          drawer still opens (it fetches its own detail by id), it just has
          no next/prev to offer. */}
      {openId && (
        <SubmissionDrawer
          eventId={eventId}
          submissionId={openId}
          timezone={timezone}
          vocabulary={vocabulary}
          canEdit={canEdit}
          onClose={() => requestDrawerTarget(null)}
          onBusyChange={setDrawerBusy}
          nav={openIndex === -1
            ? { index: 0, total: 1 }
            : {
                index: openIndex,
                total: rowIds.length,
                itemLabel: `${rows[openIndex]?.code ? `SESS-${rows[openIndex].code}: ` : ""}${rows[openIndex]?.title ?? "Submission"}`,
                ...(rowIds[openIndex - 1] ? { onPrev: () => requestDrawerTarget(rowIds[openIndex - 1] as string) } : {}),
                ...(rowIds[openIndex + 1] ? { onNext: () => requestDrawerTarget(rowIds[openIndex + 1] as string) } : {}),
              }}
        />
      )}
      {canEdit && (
        <AddAbstractDrawer
          eventId={eventId}
          vocabulary={vocabulary}
          timezone={timezone}
          speakers={speakers}
          open={adding}
          onClose={() => setAdding(false)}
        />
      )}
    </main>
  );
}
