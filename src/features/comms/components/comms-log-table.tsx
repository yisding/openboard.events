"use client";

import { Mail, RotateCcw, Search, Send, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { COMM_STATUSES, TEMPLATE_KEYS, type CommLogId, type CommLogRow, type CommStatus, type ContactId, type EventId, type TemplateKey } from "@/shared/contracts";
import { BulkActionBar } from "@/shared/ui/app/bulk-action-bar";
import { DataTable } from "@/shared/ui/app/data-table";
import { TzTime } from "@/shared/ui/app/tz-time";
import { Dash } from "@/shared/ui/app/dash";
import { Button, EmptyState, Select, StatusBadge } from "@/shared/ui/ui-kit";
import { QueryBoundary } from "@/shared/ui/app/query-boundary";
import { statusBadgeLabel } from "@/shared/ui/status-badge";
import { templateLabel } from "@/shared/ui/template-label";
import { useToast } from "@/shared/ui/toast";
import { useCommLog, useRetryFailedCommunications } from "../hooks/use-comm-log";
import { canRetryCommunication, type RetryFailedCommunicationsResult } from "../schemas";
import { LogDetailSheet } from "./log-detail-sheet";
import { SendReminderDialog } from "./send-reminder-dialog";

// P3-EMAIL added `bounced`/`complained` (Resend webhook) to `COMM_STATUSES`;
// sourced from the contract so this filter can never drift from it again.
const STATUSES: readonly CommStatus[] = COMM_STATUSES;

export function retryResultMessage(result: RetryFailedCommunicationsResult): string {
  const parts: string[] = [];
  if (result.requeued > 0) parts.push(`${result.requeued} requeued`);
  if (result.alreadyQueued > 0) parts.push(`${result.alreadyQueued} already queued`);
  if (result.ineligible > 0) parts.push(`${result.ineligible} no longer eligible`);
  if (result.notFound > 0) parts.push(`${result.notFound} not found in this event`);
  return parts.join(" · ") || "No messages were requeued";
}

type CommsLogTableProps = {
  eventId: EventId;
  contactId?: ContactId;
  contactName?: string;
  timezone: string;
};

/**
 * The audit log table (step 5). Exported client component: embedded whole by
 * this feature's own Log tab (event-wide, every filter live) and by M27's
 * speaker detail (`contactId` set, scoped to one speaker's history) — one
 * query, one set of columns, so the two surfaces cannot drift.
 */
function CommsLogTableInner({ eventId, contactId, contactName, timezone }: CommsLogTableProps) {
  const [status, setStatus] = useState<CommStatus | "">("");
  const [templateKey, setTemplateKey] = useState<TemplateKey | "">("");
  const [search, setSearch] = useState("");
  const [openLogId, setOpenLogId] = useState<CommLogId | null>(null);
  const [sendingTo, setSendingTo] = useState(false);
  const [selectionEpoch, setSelectionEpoch] = useState(0);
  const { toast } = useToast();
  const retry = useRetryFailedCommunications(eventId);

  const query = useCommLog(eventId, {
    ...(contactId ? { contactId } : {}),
    ...(status ? { status } : {}),
    ...(templateKey ? { templateKey } : {}),
    limit: 500,
  });

  const rows = useMemo(() => {
    const all = query.data ?? [];
    const needle = search.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((row) => `${row.recipientName} ${row.recipientEmail}`.toLowerCase().includes(needle));
  }, [query.data, search]);

  // Zero rows behind a filter is not the same state as zero rows at all, and
  // only one of the two is a dead end without a way back.
  const filtered = Boolean(status || templateKey || search.trim());
  function clearFilters() {
    setStatus("");
    setTemplateKey("");
    setSearch("");
  }

  // `comms-log-col-*` is the handle the ≤1024/≤768 disclosure ladder in
  // globals.css hides by, the same mechanism the submissions table uses.
  // Status carries none: it is the column this tab exists to show.
  const columns = useMemo<Array<ColumnDef<CommLogRow, unknown>>>(() => [
    {
      id: "recipient",
      header: "Recipient",
      accessorFn: (row) => row.recipientName,
      cell: ({ row }) => <div className="submission-title-cell"><b>{row.original.recipientName}</b><span>{row.original.recipientEmail}</span></div>,
      meta: { className: "comms-log-col-recipient" },
    },
    { id: "templateKey", header: "Template", accessorKey: "templateKey", cell: ({ row }) => <span className="track-chip">{templateLabel(row.original.templateKey)}</span>, meta: { className: "comms-log-col-template" } },
    // What the recipient actually saw in their inbox — the one field that tells
    // two `task_reminder` rows apart without opening either. Long subjects are
    // capped with an ellipsis in `globals.css` and carried in full by `title`,
    // and the Columns picker can hide the column outright.
    //
    // A row the dispatcher stopped *before* `renderTemplateContent` has no
    // subject at all, and an audit log may not invent one. Every send on a demo
    // event is such a row (`SkipEmail`, `comms/server/context.ts`), so the
    // column used to be a full screen of identical dashes that read as broken
    // data. The reason the row stopped — the one true thing left to say about
    // it, and the same string the drawer shows as Error — takes the cell
    // instead, muted so it can never be mistaken for a subject line.
    //
    // Only a `skipped` row proves "never rendered": every skip lands before the
    // dispatcher persists the render. Any other status with a missing subject
    // may be the 90-day retention job redacting a message that rendered fine
    // (`data-lifecycle/server/retention.ts` nulls the subject but keeps
    // `error`), and this column may not claim otherwise — those keep the dash.
    {
      id: "subject",
      header: "Subject",
      accessorKey: "subjectRendered",
      cell: ({ row }) => {
        const { subjectRendered, status, error } = row.original;
        if (subjectRendered) return <span title={subjectRendered}>{subjectRendered}</span>;
        if (status === "skipped" && error) return <span className="log-unrendered-cell" title={`Not rendered — ${error}`}>{error}</span>;
        return <Dash />;
      },
      meta: { className: "comms-log-col-subject" },
    },
    { id: "status", header: "Status", accessorKey: "status", cell: ({ row }) => <StatusBadge value={row.original.status} /> },
    { id: "providerMessageId", header: "Provider ID", accessorKey: "providerMessageId", cell: ({ row }) => <Dash value={row.original.providerMessageId} />, meta: { className: "comms-log-col-provider" } },
    { id: "createdAt", header: "Created", accessorKey: "createdAt", cell: ({ row }) => <TzTime instant={row.original.createdAt} tz={timezone} style="date" secondary="time" />, meta: { className: "comms-log-col-created" } },
    { id: "sentAt", header: "Sent", accessorKey: "sentAt", cell: ({ row }) => <TzTime instant={row.original.sentAt} tz={timezone} style="date" secondary="time" />, meta: { className: "comms-log-col-sent" } },
  ], [timezone]);

  async function retrySelected(selectedRows: CommLogRow[]): Promise<void> {
    try {
      const result = await retry.mutateAsync(selectedRows.map((row) => row.id));
      const partial = result.ineligible > 0 || result.notFound > 0;
      toast(retryResultMessage(result), partial ? { kind: "error" } : undefined);
      setSelectionEpoch((epoch) => epoch + 1);
    } catch {
      // The response can be lost after a successful commit. The hook refreshes
      // the activity list, and another click is safe because queued rows are
      // reported as already queued without altering the logical message.
      toast("Could not confirm those retries — activity is refreshing, and retrying again is safe", { kind: "error" });
    }
  }

  return (
    <section>
      <DataTable
        columns={columns}
        data={rows}
        isLoading={query.isLoading}
        getRowId={(row) => row.id}
        enableSelection
        isRowSelectable={canRetryCommunication}
        getRowLabel={(row) => `${row.recipientName}, ${templateLabel(row.templateKey)}, ${statusBadgeLabel(row.status)}`}
        selectionEpoch={selectionEpoch}
        renderSelectionBar={({ selectedRows, countLabel, clearSelection }) => (
          <BulkActionBar
            count={selectedRows.length}
            countLabel={countLabel}
            onClear={clearSelection}
            actions={(
              <Button
                size="sm"
                variant="secondary"
                disabled={retry.isPending}
                onClick={() => { void retrySelected(selectedRows); }}
              >
                <RotateCcw size={14} aria-hidden />
                {retry.isPending ? "Retrying…" : `Retry ${selectedRows.length}`}
              </Button>
            )}
          />
        )}
        onRowClick={(row) => setOpenLogId(row.id)}
        pageSize={50}
        {...(contactId ? {} : { columnVisibilityKey: `comms-log:${eventId}` })}
        toolbar={
          <>
            {!contactId && (
              <label className="table-search">
                <Search size={16} />
                <input aria-label="Search recipients" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search recipients" />
                {search && <button type="button" aria-label="Clear search" onClick={() => setSearch("")}><X size={14} /></button>}
              </label>
            )}
            <Select className="filter-button" value={status} onChange={(event) => setStatus(event.target.value as CommStatus | "")} aria-label="Filter by status">
              <option value="">All statuses</option>
              {STATUSES.map((value) => <option key={value} value={value}>{statusBadgeLabel(value)}</option>)}
            </Select>
            <Select className="filter-button" value={templateKey} onChange={(event) => setTemplateKey(event.target.value as TemplateKey | "")} aria-label="Filter by template">
              <option value="">All templates</option>
              {TEMPLATE_KEYS.map((key) => <option key={key} value={key}>{templateLabel(key)}</option>)}
            </Select>
            {contactId && (
              <Button size="sm" variant="secondary" onClick={() => setSendingTo(true)}><Send size={14} /> Send reminder now</Button>
            )}
          </>
        }
        empty={
          <EmptyState
            icon={<Mail size={20} />}
            title={filtered ? "Nothing matches these filters" : "No emails yet"}
            description={filtered
              // Describe the filters rather than assert prior sends: an event
              // that has never sent anything can reach this state too, and the
              // recipient search is not rendered on the speaker embed.
              ? (contactId
                ? "No message matches the status or template you picked."
                : "No message matches the status, template, or recipient you picked.")
              : "Emails appear here the moment a form is submitted or a decision is sent."}
            {...(filtered ? { action: <Button variant="secondary" onClick={clearFilters}>Clear filters</Button> } : {})}
          />
        }
      />
      <LogDetailSheet eventId={eventId} logId={openLogId} timezone={timezone} onClose={() => setOpenLogId(null)} />
      {contactId && sendingTo && (
        <SendReminderDialog eventId={eventId} contactId={contactId} contactName={contactName ?? "this speaker"} timezone={timezone} onClose={() => setSendingTo(false)} />
      )}
    </section>
  );
}

/**
 * Reuses the page cache when embedded and creates a local one for a standalone
 * consumer. The conditional boundary prevents nested providers from splitting
 * a mutation's invalidation from the visible list.
 */
export function CommsLogTable(props: CommsLogTableProps) {
  return <QueryBoundary><CommsLogTableInner {...props} /></QueryBoundary>;
}
