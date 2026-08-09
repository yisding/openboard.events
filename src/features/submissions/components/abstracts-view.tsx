"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import type { SubmissionListRow, SubmissionStatus } from "@/shared/contracts";
import { PageHeader } from "@/shared/ui/ui-kit";
import { AbstractsTable } from "./abstracts-table";
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
}: {
  eventId: string;
  rows: SubmissionListRow[];
  counts: Record<SubmissionStatus | "all", number>;
  status: SubmissionStatus | "all";
  search: string;
  timezone: string;
  total: number;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [selected, setSelected] = useState<SubmissionListRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

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

  return (
    <main className="page">
      <PageHeader
        eyebrow="PROGRAM"
        title="Abstracts"
        description="Every proposal for this event, with its status, track and rating."
      />
      <DecisionBar
        eventId={eventId}
        selected={selected}
        pendingNotify={counts.accept_queue + counts.decline_queue}
        onDone={() => setSelected([])}
      />
      <AbstractsTable
        rows={rows}
        counts={counts}
        status={status}
        search={search}
        timezone={timezone}
        total={total}
        onFilter={onFilter}
        onSelectionChange={setSelected}
        onRowClick={(row) => setOpenId(row.submissionId)}
      />
      {openId && (
        <SubmissionDrawer
          eventId={eventId}
          submissionId={openId}
          timezone={timezone}
          onClose={() => setOpenId(null)}
        />
      )}
    </main>
  );
}
