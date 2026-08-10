"use client";

import { ClipboardCheck, Plus, UserPlus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { ColorChip } from "@/shared/ui/app/color-chip";
import { ConfirmDialog } from "@/shared/ui/app/confirm-dialog";
import { DataTable } from "@/shared/ui/app/data-table";
import { Button, EmptyState, PageHeader, ProgressBar, StatusBadge } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import type { PlanDTO } from "../types";
import { AssignmentDrawer } from "./assignment-drawer";
import { PlanEditor } from "./plan-editor";
import { ReviewerInviteDialog } from "./reviewer-invite-dialog";

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
  const [pendingDelete, setPendingDelete] = useState<PlanDTO | null>(null);
  const [assigning, setAssigning] = useState<PlanDTO | null>(null);
  const [inviting, setInviting] = useState(false);

  useEffect(() => {
    const refreshProgress = () => router.refresh();
    window.addEventListener("focus", refreshProgress);
    return () => window.removeEventListener("focus", refreshProgress);
  }, [router]);

  const trackName = useMemo(() => new Map(tracks.map((track) => [track.id, track])), [tracks]);
  const nextRound = plans.reduce((highest, plan) => Math.max(highest, plan.round), 0) + 1;

  /**
   * The bulk nudge. It reaches only reviewers who still have outstanding work
   * in an open window — the server refuses the rest — and every row it writes
   * lands in the communication log like any other message.
   */
  async function remind(plan: PlanDTO) {
    setBusy(true);
    try {
      const response = await fetch(`/api/internal/evaluation/${eventId}/plans/${plan.id}/reminders`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reviewerUserIds: null }),
      });
      const payload = await response.json().catch(() => null) as { data?: { enqueued: number; skipped: number }; error?: { message?: string } } | null;
      if (!response.ok || !payload?.data) {
        toast(payload?.error?.message ?? "Those reminders did not send");
        return;
      }
      toast(payload.data.enqueued === 0
        ? "Nobody on this round has outstanding work"
        : `Reminded ${payload.data.enqueued} reviewer${payload.data.enqueued === 1 ? "" : "s"}${payload.data.skipped > 0 ? ` · ${payload.data.skipped} had no contact record` : ""}`);
      router.refresh();
    } catch {
      toast("Those reminders did not send");
    } finally {
      setBusy(false);
    }
  }

  async function remove(plan: PlanDTO) {
    setBusy(true);
    try {
      const response = await fetch(`/api/internal/evaluation/${eventId}/plans/${plan.id}`, { method: "DELETE" });
      const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      // The server refuses to delete a round that holds verdicts and says to
      // close it instead; that message is the useful one, so pass it through.
      toast(response.ok ? `${plan.name} deleted` : payload?.error?.message ?? "That round could not be deleted");
      if (response.ok) router.refresh();
    } catch {
      toast("That round could not be deleted");
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
      id: "window",
      header: "Window",
      enableSorting: false,
      accessorFn: (plan) => plan.opensAt ?? "",
      cell: ({ row }) => (
        <div className="plan-window">
          <span>
            {row.original.opensAt ? new Date(row.original.opensAt).toLocaleString() : "Open now"}
            {" → "}
            {row.original.closesAt ? new Date(row.original.closesAt).toLocaleString() : "No close date"}
          </span>
          {row.original.anonymizeAuthors && <small>Blind review</small>}
        </div>
      ),
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
              {reviewer.name || reviewer.email}{" "}
              <small>
                {reviewer.completed}/{reviewer.assigned}
                {reviewer.recused > 0 && ` · ${reviewer.recused} recused`}
              </small>
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
          <Button size="sm" variant="secondary" onClick={() => setAssigning(row.original)}>Assign</Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => remind(row.original)}>Remind</Button>
          <Button size="sm" variant="secondary" onClick={() => setEditing(row.original)}>Edit</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setPendingDelete(row.original)}>Delete</Button>
        </span>
      ),
    },
  // `remind` is stable enough for the row actions; the columns only need to be
  // rebuilt when the vocabulary or the busy flag changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [trackName, busy]);

  return (
    <main className="page">
      <PageHeader
        eyebrow="REVIEW"
        title="Evaluation"
        description="Scoring rounds, who reviews which tracks, and how far each round has got."
        actions={
          <span className="row-actions">
            <Button variant="secondary" onClick={() => setInviting(true)}><UserPlus size={16} /> Invite reviewer</Button>
            <Button onClick={() => setCreating(true)}><Plus size={16} /> New evaluation plan</Button>
          </span>
        }
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

      {assigning && <AssignmentDrawer eventId={eventId} plan={assigning} onClose={() => setAssigning(null)} />}
      {inviting && <ReviewerInviteDialog eventId={eventId} onClose={() => setInviting(false)} />}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Delete ${pendingDelete?.name ?? "this evaluation plan"}?`}
        body="This permanently removes the round and its reviewer assignments. Rounds with completed reviews cannot be deleted."
        confirmLabel="Delete plan"
        onConfirm={async () => {
          if (!pendingDelete) return;
          await remove(pendingDelete);
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </main>
  );
}
