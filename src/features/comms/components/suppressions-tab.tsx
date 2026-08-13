"use client";

import { ShieldOff, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import type { ContactId, EventId } from "@/shared/contracts";
import type { SuppressionRow } from "@/features/comms";
import { DataTable } from "@/shared/ui/app/data-table";
import { TzTime } from "@/shared/ui/app/tz-time";
import { Button, EmptyState, StatusBadge } from "@/shared/ui/ui-kit";
import { ConfirmDialog } from "@/shared/ui/app/confirm-dialog";
import { useToast } from "@/shared/ui/toast";
import { useRemoveSuppression, useSuppressions } from "../hooks/use-suppressions";

/**
 * M46 — suppression list admin UI. Every row is a Resend-confirmed hard
 * bounce or spam complaint (`recordSuppressionIn`, the webhook handler);
 * suppression blocks *every* send to that address, including decision and
 * schedule mail, so this is the surface where an organizer investigates
 * "why didn't Speaker X get their acceptance email" and — once they have
 * confirmed the address is fixed or the complaint was a mistake — reinstate
 * it. There is no manual "add a suppression" here: this table only ever
 * reflects what Resend actually reported.
 */
export function SuppressionsTab({ eventId, timezone, initialData }: { eventId: EventId; timezone: string; initialData: SuppressionRow[] }) {
  const { toast } = useToast();
  const query = useSuppressions(eventId, initialData);
  const remove = useRemoveSuppression(eventId);
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState<SuppressionRow | null>(null);
  const rows = query.data ?? initialData;

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => `${row.name} ${row.email}`.toLowerCase().includes(needle));
  }, [rows, search]);

  const columns = useMemo<Array<ColumnDef<SuppressionRow, unknown>>>(() => [
    {
      id: "recipient",
      header: "Recipient",
      accessorFn: (row) => row.name,
      cell: ({ row }) => <div className="submission-title-cell"><b>{row.original.name}</b><span>{row.original.email}</span></div>,
    },
    { id: "reason", header: "Reason", accessorKey: "reason", cell: ({ row }) => <StatusBadge value={row.original.reason === "bounce" ? "bounced" : "complained"} /> },
    { id: "suppressedAt", header: "Suppressed", accessorKey: "suppressedAt", cell: ({ row }) => <TzTime instant={row.original.suppressedAt} tz={timezone} style="date" secondary="time" /> },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => <Button size="sm" variant="secondary" onClick={() => setPending(row.original)}>Reinstate</Button>,
    },
  ], [timezone]);

  async function confirmRemove(contactId: ContactId) {
    try {
      await remove.mutateAsync(contactId);
      toast("Reinstated — future sends to this address will resume");
    } catch {
      toast("Could not reinstate this address", { kind: "error" });
    }
  }

  return (
    <section>
      <DataTable
        columns={columns}
        data={filtered}
        isLoading={query.isLoading}
        getRowId={(row) => row.contactId}
        pageSize={50}
        toolbar={
          <label className="table-search">
            <Search size={16} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search suppressed addresses" />
            {search && <button type="button" aria-label="Clear search" onClick={() => setSearch("")}><X size={14} /></button>}
          </label>
        }
        empty={
          <EmptyState
            icon={<ShieldOff size={20} />}
            title="No suppressed addresses"
            description="Addresses appear here automatically after a hard bounce or spam complaint reported by Resend."
          />
        }
      />
      <ConfirmDialog
        open={pending !== null}
        variant="destructive"
        title={pending ? `Reinstate ${pending.name}?` : "Reinstate this address?"}
        body="Future emails to this address resume — decision, schedule, and every other message this event sends. Only reinstate an address you've confirmed is safe to mail again."
        confirmLabel="Reinstate"
        onConfirm={async () => { if (pending) await confirmRemove(pending.contactId); setPending(null); }}
        onCancel={() => setPending(null)}
      />
    </section>
  );
}
