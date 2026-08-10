"use client";

import { Mail, Search, Send, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { COMM_STATUSES, TEMPLATE_KEYS, type CommLogId, type CommLogRow, type CommStatus, type ContactId, type EventId, type TemplateKey } from "@/shared/contracts";
import { DataTable } from "@/shared/ui/app/data-table";
import { TzTime } from "@/shared/ui/app/tz-time";
import { Dash } from "@/shared/ui/app/dash";
import { Button, EmptyState, StatusBadge } from "@/shared/ui/ui-kit";
import { useCommLog } from "../hooks/use-comm-log";
import { LogDetailSheet } from "./log-detail-sheet";
import { SendReminderDialog } from "./send-reminder-dialog";

// P3-EMAIL added `bounced`/`complained` (Resend webhook) to `COMM_STATUSES`;
// sourced from the contract so this filter can never drift from it again.
const STATUSES: readonly CommStatus[] = COMM_STATUSES;

function humanizeKey(key: TemplateKey): string {
  return key.replaceAll("_", " ");
}

type CommsLogTableProps = {
  eventId: EventId;
  contactId?: ContactId;
  contactName?: string;
  timezone: string;
  /** Only valid for the unfiltered, `contactId`-matching default query — see below. */
  initialData?: CommLogRow[];
};

/**
 * The audit log table (step 5). Exported client component: embedded whole by
 * this feature's own Log tab (event-wide, every filter live) and by M27's
 * speaker detail (`contactId` set, scoped to one speaker's history) — one
 * query, one set of columns, so the two surfaces cannot drift.
 */
function CommsLogTableInner({ eventId, contactId, contactName, timezone, initialData }: CommsLogTableProps) {
  const [status, setStatus] = useState<CommStatus | "">("");
  const [templateKey, setTemplateKey] = useState<TemplateKey | "">("");
  const [search, setSearch] = useState("");
  const [openLogId, setOpenLogId] = useState<CommLogId | null>(null);
  const [sendingTo, setSendingTo] = useState(false);

  // `initialData` only matches the server-fetched shape while no filter has
  // been touched — the moment status/templateKey change, this is a different
  // query key and TanStack fetches it fresh regardless.
  const isDefaultFilter = status === "" && templateKey === "";
  const query = useCommLog(eventId, {
    ...(contactId ? { contactId } : {}),
    ...(status ? { status } : {}),
    ...(templateKey ? { templateKey } : {}),
    limit: 500,
  }, isDefaultFilter ? initialData : undefined);

  const rows = useMemo(() => {
    const all = query.data ?? [];
    const needle = search.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((row) => `${row.recipientName} ${row.recipientEmail}`.toLowerCase().includes(needle));
  }, [query.data, search]);

  const columns = useMemo<Array<ColumnDef<CommLogRow, unknown>>>(() => [
    {
      id: "recipient",
      header: "Recipient",
      accessorFn: (row) => row.recipientName,
      cell: ({ row }) => <div className="submission-title-cell"><b>{row.original.recipientName}</b><span>{row.original.recipientEmail}</span></div>,
    },
    { id: "templateKey", header: "Template", accessorKey: "templateKey", cell: ({ row }) => <span className="track-chip">{humanizeKey(row.original.templateKey)}</span> },
    { id: "status", header: "Status", accessorKey: "status", cell: ({ row }) => <StatusBadge value={row.original.status} /> },
    { id: "providerMessageId", header: "Provider ID", accessorKey: "providerMessageId", cell: ({ row }) => <Dash value={row.original.providerMessageId} /> },
    { id: "createdAt", header: "Created", accessorKey: "createdAt", cell: ({ row }) => <TzTime instant={row.original.createdAt} tz={timezone} style="date" secondary="time" /> },
    { id: "sentAt", header: "Sent", accessorKey: "sentAt", cell: ({ row }) => <TzTime instant={row.original.sentAt} tz={timezone} style="date" secondary="time" /> },
  ], [timezone]);

  return (
    <section>
      <DataTable
        columns={columns}
        data={rows}
        isLoading={query.isLoading}
        getRowId={(row) => row.id}
        onRowClick={(row) => setOpenLogId(row.id)}
        pageSize={50}
        {...(contactId ? {} : { columnVisibilityKey: `comms-log:${eventId}` })}
        toolbar={
          <>
            {!contactId && (
              <label className="table-search">
                <Search size={16} />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search recipients" />
                {search && <button type="button" onClick={() => setSearch("")}><X size={14} /></button>}
              </label>
            )}
            <select className="filter-button" value={status} onChange={(event) => setStatus(event.target.value as CommStatus | "")} aria-label="Filter by status">
              <option value="">All statuses</option>
              {STATUSES.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
            <select className="filter-button" value={templateKey} onChange={(event) => setTemplateKey(event.target.value as TemplateKey | "")} aria-label="Filter by template">
              <option value="">All templates</option>
              {TEMPLATE_KEYS.map((key) => <option key={key} value={key}>{humanizeKey(key)}</option>)}
            </select>
            {contactId && (
              <Button size="sm" variant="secondary" onClick={() => setSendingTo(true)}><Send size={14} /> Send reminder now</Button>
            )}
          </>
        }
        empty={
          <EmptyState
            icon={<Mail size={20} />}
            title="No emails yet"
            description="Emails appear here the moment a form is submitted or a decision is sent."
          />
        }
      />
      <LogDetailSheet eventId={eventId} logId={openLogId} timezone={timezone} onClose={() => setOpenLogId(null)} />
      {contactId && sendingTo && (
        <SendReminderDialog eventId={eventId} contactId={contactId} contactName={contactName ?? "this speaker"} onClose={() => setSendingTo(false)} />
      )}
    </section>
  );
}

/**
 * Owns its own `QueryClient` so a standalone consumer (M27's speaker detail)
 * never has to wrap the whole page in a provider just to embed one table.
 * When this component renders inside `CommsAdminPage` (which already provides
 * one), the nested provider is harmless — TanStack Query scopes queries to the
 * nearest provider, and each has its own in-memory cache.
 */
export function CommsLogTable(props: CommsLogTableProps) {
  const [client] = useState(() => new QueryClient());
  return <QueryClientProvider client={client}><CommsLogTableInner {...props} /></QueryClientProvider>;
}
