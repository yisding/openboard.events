"use client";

import { Radar } from "lucide-react";
import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import type { EventId } from "@/shared/contracts";
import type { DomainDeliverabilityRow } from "@/features/comms";
import { DataTable } from "@/shared/ui/app/data-table";
import { StatTile } from "@/shared/ui/app/stat-tile";
import { EmptyState } from "@/shared/ui/ui-kit";
import { useDeliverability } from "../hooks/use-deliverability";

// Above these thresholds Resend's own guidance treats a sending domain as at
// risk — not a hard cutoff, just where the tile switches from informational
// to a warning tone so an organizer notices without a separate alerting system.
const BOUNCE_WARN_PCT = 5;
const COMPLAINT_WARN_PCT = 0.1;

function formatPct(value: number): string {
  return `${value.toFixed(1)}%`;
}

/**
 * M46 — per-domain deliverability visibility, straight off the aggregates
 * `communication_logs` already carries (no new tracking, no third-party
 * reputation API — the roadmap names this an aggregate view). Top row is
 * the event-wide rollup; the table below is where a specific domain (a
 * corporate mail gateway greylisting the sender, a Gmail spam-folder
 * pattern) becomes visible instead of buried in the flat Log tab.
 */
export function DeliverabilityTab({ eventId, initialData }: { eventId: EventId; initialData: DomainDeliverabilityRow[] }) {
  const query = useDeliverability(eventId, initialData);
  const rows = query.data ?? initialData;

  const totals = useMemo(() => {
    const sent = rows.reduce((sum, row) => sum + row.sent, 0);
    const bounced = rows.reduce((sum, row) => sum + row.bounced, 0);
    const complained = rows.reduce((sum, row) => sum + row.complained, 0);
    const settled = sent + bounced + complained;
    const bounceRatePct = settled > 0 ? Math.round((bounced / settled) * 1000) / 10 : 0;
    const complaintRatePct = settled > 0 ? Math.round((complained / settled) * 1000) / 10 : 0;
    return { sent, bounced, complained, bounceRatePct, complaintRatePct };
  }, [rows]);

  const columns = useMemo<Array<ColumnDef<DomainDeliverabilityRow, unknown>>>(() => [
    { id: "domain", header: "Domain", accessorKey: "domain", cell: ({ row }) => <b>{row.original.domain}</b> },
    { id: "sent", header: "Sent", accessorKey: "sent" },
    { id: "bounced", header: "Bounced", accessorKey: "bounced" },
    { id: "complained", header: "Complained", accessorKey: "complained" },
    { id: "failed", header: "Failed", accessorKey: "failed" },
    {
      id: "bounceRatePct",
      header: "Bounce rate",
      accessorKey: "bounceRatePct",
      cell: ({ row }) => <span className={row.original.bounceRatePct >= BOUNCE_WARN_PCT ? "deliverability-rate-warn" : undefined}>{formatPct(row.original.bounceRatePct)}</span>,
    },
    {
      id: "complaintRatePct",
      header: "Complaint rate",
      accessorKey: "complaintRatePct",
      cell: ({ row }) => <span className={row.original.complaintRatePct >= COMPLAINT_WARN_PCT ? "deliverability-rate-warn" : undefined}>{formatPct(row.original.complaintRatePct)}</span>,
    },
  ], []);

  return (
    <section className="deliverability-tab">
      <div className="summary-row">
        <StatTile label="Sent" value={totals.sent} />
        <StatTile
          label="Bounce rate"
          value={formatPct(totals.bounceRatePct)}
          tone={totals.bounceRatePct >= BOUNCE_WARN_PCT ? "danger" : "default"}
          hint={`${totals.bounced} bounced`}
        />
        <StatTile
          label="Complaint rate"
          value={formatPct(totals.complaintRatePct)}
          tone={totals.complaintRatePct >= COMPLAINT_WARN_PCT ? "danger" : "default"}
          hint={`${totals.complained} complained`}
        />
        <StatTile label="Domains" value={rows.length} hint="sending to" />
      </div>
      <DataTable
        columns={columns}
        data={rows}
        isLoading={query.isLoading}
        getRowId={(row) => row.domain}
        pageSize={25}
        empty={
          <EmptyState
            icon={<Radar size={20} />}
            title="No delivery data yet"
            description="Domain-level deliverability appears here once the first email for this event is sent."
          />
        }
      />
      <p className="long-copy deliverability-footnote">
        Rates are computed against sends that reached a definitive outcome (sent, bounced, or complained) — a
        domain that is still mostly queued will not show a misleadingly low rate. A high bounce rate on one
        domain usually means a typo pattern or a full mailbox; a high complaint rate means recipients are
        marking this event&apos;s mail as spam, which is worth investigating before it affects the whole sending
        domain&apos;s reputation.
      </p>
    </section>
  );
}
