"use client";

import { ClipboardCheck, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { ColorChip } from "@/shared/ui/app/color-chip";
import { DataTable } from "@/shared/ui/app/data-table";
import { Button, EmptyState, PageHeader, ProgressBar, StatusBadge } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import type { PlanDTO } from "../types";
import { PlanEditor } from "./plan-editor";

export type TrackOption = { id: string; name: string; color: string | null };
export type EventMember = { userId: string; name: string; email: string; role: string };

/**
 * Program → Evaluation: the rounds an organizer runs, and how far each has got.
 *
 * Progress is the reason this page exists — "who still owes me scores" is the
 * question an organizer asks every day of a review week, and it is per reviewer
 * over their own slice, not over the whole round.
 */
export function PlansView({
  eventId,
  plans,
  tracks,
  members,
}: {
  eventId: string;
  plans: PlanDTO[];
  tracks: TrackOption[];
  members: EventMember[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [editing, setEditing] = useState<PlanDTO | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  const trackName = useMemo(() => new Map(tracks.map((track) => [track.id, track])), [tracks]);
  const nextRound = plans.reduce((highest, plan) => Math.max(highest, plan.round), 0) + 1;

  async function remove(plan: PlanDTO) {
    setBusy(true);
    try {
      const response = await fetch(`/api/internal/evaluation/${eventId}/plans/${plan.id}`, { method: "DELETE" });
      const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      // The server refuses to delete a round that holds verdicts and says to
      // close it instead; that message is the useful one, so pass it through.
      toast(response.ok ? `${plan.name} deleted` : payload?.error?.message ?? "That round could not be deleted");
      if (response.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const columns = useMemo<Array<ColumnDef<PlanDTO, unknown>>>(() => [
    { id: "name", header: "Round", accessorKey: "name", cell: ({ row }) => <b>{row.original.name}</b> },
    { id: "round", header: "#", accessorKey: "round" },
    {
      id: "scale",
      header: "Scale",
      accessorFn: (plan) => plan.scaleMax,
      cell: ({ row }) => <span>{row.original.scaleMin}–{row.original.scaleMax}</span>,
    },
    {
      id: "scope",
      header: "Scope",
      accessorFn: (plan) => plan.trackIds?.length ?? 0,
      cell: ({ row }) => row.original.trackIds === null
        ? <span>All tracks</span>
        : <span className="chip-row">
            {row.original.trackIds.map((trackId) => (
              <ColorChip key={trackId} label={trackName.get(trackId)?.name ?? "Unknown track"} color={trackName.get(trackId)?.color ?? null} />
            ))}
          </span>,
    },
    {
      id: "reviewers",
      header: "Reviewers",
      accessorFn: (plan) => plan.reviewers.length,
      cell: ({ row }) => (
        <ul className="reviewer-progress">
          {row.original.reviewers.length === 0 && <li>Nobody assigned</li>}
          {row.original.reviewers.map((reviewer) => (
            <li key={reviewer.userId}>
              {reviewer.name || reviewer.email} <small>{reviewer.scored}/{reviewer.assigned}</small>
            </li>
          ))}
        </ul>
      ),
    },
    {
      id: "progress",
      header: "Progress",
      accessorFn: (plan) => plan.progress.total === 0 ? 0 : plan.progress.scored / plan.progress.total,
      cell: ({ row }) => (
        <div className="plan-progress">
          <span>{row.original.progress.scored}/{row.original.progress.total}</span>
          <ProgressBar value={row.original.progress.total === 0 ? 0 : Math.round((row.original.progress.scored / row.original.progress.total) * 100)} />
        </div>
      ),
    },
    { id: "status", header: "Status", accessorKey: "status", cell: ({ row }) => <StatusBadge value={row.original.status} /> },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => (
        <span className="row-actions">
          <Button size="sm" variant="secondary" onClick={() => setEditing(row.original)}>Edit</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => remove(row.original)}>Delete</Button>
        </span>
      ),
    },
    // `remove` is stable enough for a row action and re-creating the columns on
    // every render would reset the table's own state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [trackName, busy]);

  return (
    <main className="page">
      <PageHeader
        eyebrow="REVIEW"
        title="Evaluation"
        description="Scoring rounds, who reviews which tracks, and how far each round has got."
        actions={<Button onClick={() => setCreating(true)}><Plus size={16} /> New evaluation plan</Button>}
      />

      <DataTable
        columns={columns}
        data={plans}
        columnVisibilityKey="evaluation-plans"
        getRowId={(plan) => plan.id}
        empty={
          <EmptyState
            icon={<ClipboardCheck size={20} />}
            title="No evaluation plans yet — create one to start scoring"
            description="A round sets the scale, any criteria, and which reviewers see which tracks."
            action={<Button onClick={() => setCreating(true)}>New evaluation plan</Button>}
          />
        }
      />

      {(creating || editing) && (
        <PlanEditor
          eventId={eventId}
          plan={editing}
          tracks={tracks}
          members={members}
          nextRound={nextRound}
          onClose={() => { setCreating(false); setEditing(null); }}
        />
      )}
    </main>
  );
}
