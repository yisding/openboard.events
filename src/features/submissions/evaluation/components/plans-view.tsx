"use client";

import { ClipboardCheck, Plus, UserPlus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { ColorChip } from "@/shared/ui/app/color-chip";
import { ConfirmDialog } from "@/shared/ui/app/confirm-dialog";
import { DataTable } from "@/shared/ui/app/data-table";
import { TzTime } from "@/shared/ui/app/tz-time";
import { Button, EmptyState, PageHeader, ProgressBar, StatusBadge } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import type { OrganizationInvitationDTO } from "@/shared/contracts";
import type { PlanDTO } from "../types";
import { AssignmentDrawer } from "./assignment-drawer";
import { PlanEditor } from "./plan-editor";
import { ReviewerInviteDialog } from "./reviewer-invite-dialog";

export type TrackOption = { id: string; name: string; color: string | null };
export type EventMember = { userId: string; name: string; email: string; role: string };
type Requester = (input: string, init?: RequestInit) => Promise<Response>;
type ReminderRecipient = { reviewerUserId: string; name: string; email: string; outstanding: number };
type ReminderDialogState = {
  plan: PlanDTO;
  attemptId: string;
  preview: ReminderRecipient[] | null;
  previewing: boolean;
  previewError: string;
  sendError: string;
};

export async function deleteEvaluationPlan(eventId: string, planId: string, request: Requester = fetch): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const response = await request(`/api/internal/evaluation/${eventId}/plans/${planId}`, { method: "DELETE" });
    const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    return response.ok
      ? { ok: true }
      : { ok: false, message: payload?.error?.message ?? "That round could not be deleted" };
  } catch {
    return { ok: false, message: "That round could not be deleted" };
  }
}

export async function completeEvaluationPlanDelete(
  eventId: string,
  plan: PlanDTO,
  effects: { onError: (message: string) => void; onDeleted: () => void; refresh: () => void; closeConfirmation: () => void },
  request: Requester = fetch,
): Promise<boolean> {
  const result = await deleteEvaluationPlan(eventId, plan.id, request);
  if (!result.ok) {
    effects.onError(result.message);
    return false;
  }
  effects.onDeleted();
  effects.refresh();
  effects.closeConfirmation();
  return true;
}

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
  pendingReviewerInvitations,
  timezone,
}: {
  eventId: string;
  plans: PlanDTO[];
  tracks: TrackOption[];
  members: EventMember[];
  pendingReviewerInvitations: OrganizationInvitationDTO[];
  /** The event's zone — a round's open/close window is set in it. */
  timezone: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [editing, setEditing] = useState<PlanDTO | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PlanDTO | null>(null);
  const [assigning, setAssigning] = useState<PlanDTO | null>(null);
  const [inviting, setInviting] = useState(false);
  const [reminderDialog, setReminderDialog] = useState<ReminderDialogState | null>(null);
  const reminderTargetRef = useRef<string | null>(null);
  const previewRequestRef = useRef(0);
  const sendRequestRef = useRef(0);
  const sendingReminderRef = useRef(false);

  useEffect(() => {
    const refreshProgress = () => router.refresh();
    window.addEventListener("focus", refreshProgress);
    return () => window.removeEventListener("focus", refreshProgress);
  }, [router]);

  const trackName = useMemo(() => new Map(tracks.map((track) => [track.id, track])), [tracks]);
  const nextRound = plans.reduce((highest, plan) => Math.max(highest, plan.round), 0) + 1;

  async function loadReminderPreview(plan: PlanDTO) {
    const target = String(plan.id);
    const requestId = previewRequestRef.current + 1;
    previewRequestRef.current = requestId;
    setReminderDialog((current) => current?.plan.id === plan.id
      ? { ...current, preview: null, previewing: true, previewError: "", sendError: "" }
      : current);
    try {
      const response = await fetch(`/api/internal/evaluation/${eventId}/plans/${plan.id}/reminders`);
      const payload = await response.json().catch(() => null) as {
        data?: { reviewers?: ReminderRecipient[] };
        error?: { message?: string };
      } | null;
      if (previewRequestRef.current !== requestId || reminderTargetRef.current !== target) return;
      if (!response.ok || !Array.isArray(payload?.data?.reviewers)) {
        setReminderDialog((current) => current?.plan.id === plan.id
          ? { ...current, previewError: payload?.error?.message ?? "Could not prepare the reminder preview" }
          : current);
        return;
      }
      setReminderDialog((current) => current?.plan.id === plan.id
        ? { ...current, preview: payload.data?.reviewers ?? [], previewError: "" }
        : current);
    } catch {
      if (previewRequestRef.current === requestId && reminderTargetRef.current === target) {
        setReminderDialog((current) => current?.plan.id === plan.id
          ? { ...current, previewError: "Could not reach the server to preview these reminders" }
          : current);
      }
    } finally {
      if (previewRequestRef.current === requestId && reminderTargetRef.current === target) {
        setReminderDialog((current) => current?.plan.id === plan.id
          ? { ...current, previewing: false }
          : current);
      }
    }
  }

  function openReminderPreflight(plan: PlanDTO) {
    reminderTargetRef.current = String(plan.id);
    setReminderDialog({ plan, attemptId: crypto.randomUUID(), preview: null, previewing: true, previewError: "", sendError: "" });
    void loadReminderPreview(plan);
  }

  function closeReminderPreflight() {
    reminderTargetRef.current = null;
    previewRequestRef.current += 1;
    setReminderDialog(null);
  }

  /**
   * The bulk nudge. The preview makes its exact audience visible first, while
   * the POST still re-decides who has outstanding work in an open window.
   */
  async function sendReminders() {
    const state = reminderDialog;
    if (!state?.preview || state.preview.length === 0 || state.previewing || sendingReminderRef.current) return;
    const plan = state.plan;
    const target = String(plan.id);
    const requestId = sendRequestRef.current + 1;
    sendRequestRef.current = requestId;
    sendingReminderRef.current = true;
    setBusy(true);
    setReminderDialog((current) => current?.plan.id === plan.id ? { ...current, sendError: "" } : current);
    try {
      const response = await fetch(`/api/internal/evaluation/${eventId}/plans/${plan.id}/reminders`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reviewerUserIds: null, attemptId: state.attemptId }),
      });
      const payload = await response.json().catch(() => null) as { data?: { enqueued: number; skipped: number }; error?: { message?: string } } | null;
      if (!response.ok || !payload?.data) {
        if (sendRequestRef.current === requestId && reminderTargetRef.current === target) {
          setReminderDialog((current) => current?.plan.id === plan.id
            ? { ...current, sendError: payload?.error?.message ?? "Those reminders did not send" }
            : current);
        }
        return;
      }
      const message = payload.data.enqueued === 0
        ? "Nobody on this round has outstanding work"
        : `Reminded ${payload.data.enqueued} reviewer${payload.data.enqueued === 1 ? "" : "s"}${payload.data.skipped > 0 ? ` · ${payload.data.skipped} had no contact record` : ""}`;
      toast(message);
      router.refresh();
      if (sendRequestRef.current === requestId && reminderTargetRef.current === target) closeReminderPreflight();
    } catch {
      if (sendRequestRef.current === requestId && reminderTargetRef.current === target) {
        setReminderDialog((current) => current?.plan.id === plan.id
          ? { ...current, sendError: "Could not reach the server. These reminders were not confirmed; check Communications before retrying." }
          : current);
      }
    } finally {
      if (sendRequestRef.current === requestId) {
        sendingReminderRef.current = false;
        setBusy(false);
      }
    }
  }

  async function remove(plan: PlanDTO): Promise<boolean> {
    setBusy(true);
    try {
      // The server refuses to delete a round that holds verdicts and says to
      // close it instead; that message is the useful one, so pass it through.
      return completeEvaluationPlanDelete(eventId, plan, {
        onError: (message) => toast(message, { kind: "error" }),
        onDeleted: () => toast(`${plan.name} deleted`),
        refresh: () => router.refresh(),
        closeConfirmation: () => setPendingDelete(null),
      });
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
              <ColorChip key={trackId} label={trackName.get(trackId)?.name ?? "Unknown track"} />
            ))}
          </span>,
    },
    {
      id: "window",
      header: "Window",
      enableSorting: false,
      accessorFn: (plan) => plan.opensAt ?? "",
      // Read in the event's zone, so the column agrees with the editor that
      // wrote it. `toLocaleString()` renders in the *viewer's* zone, which is
      // the same defect this change set is closing on the input side — a window
      // saved correctly for 09:00 in Los Angeles read 17:00 to an organizer in
      // London, and nothing on screen said which one it meant.
      cell: ({ row }) => (
        <div className="plan-window">
          <span>
            {row.original.opensAt ? <TzTime instant={row.original.opensAt} tz={timezone} /> : "Open now"}
            {" → "}
            {row.original.closesAt ? <TzTime instant={row.original.closesAt} tz={timezone} /> : "No close date"}
          </span>
          {row.original.anonymizeAuthors && <small>Blind review</small>}
          <small>{row.original.showPeerScores ? "Committee averages shared" : "Independent scoring"}</small>
        </div>
      ),
    },
    {
      id: "reviewers",
      header: "Reviewers",
      accessorFn: (plan) => plan.reviewers.length,
      cell: ({ row }) => {
        // M56 — reviewer-load mini-bars: assignment count relative to this
        // round's busiest reviewer, so "one reviewer got 80 abstracts" is
        // visible at a glance instead of buried in a column of numbers.
        const maxAssigned = Math.max(1, ...row.original.reviewers.map((reviewer) => reviewer.assigned));
        return (
          <ul className="reviewer-progress">
            {row.original.reviewers.length === 0 && <li>Nobody assigned</li>}
            {row.original.reviewers.map((reviewer) => (
              <li key={reviewer.userId}>
                {reviewer.name || reviewer.email}{" "}
                <small>
                  {reviewer.completed}/{reviewer.assigned}
                  {reviewer.recused > 0 && ` · ${reviewer.recused} recused`}
                </small>
                {reviewer.assigned > 0 && (
                  <span className="dashboard-bar reviewer-load-bar" aria-hidden="true" title={`${reviewer.assigned} assigned`}>
                    <i style={{ width: `${(reviewer.assigned / maxAssigned) * 100}%` }} />
                  </span>
                )}
              </li>
            ))}
          </ul>
        );
      },
    },
    {
      id: "progress",
      header: "Progress",
      accessorFn: (plan) => plan.progress.total === 0 ? 0 : plan.progress.scored / plan.progress.total,
      cell: ({ row }) => (
        <div className="plan-progress">
          <span>{row.original.progress.scored}/{row.original.progress.total}</span>
          <ProgressBar label={`Review progress for ${row.original.name}`} value={row.original.progress.total === 0 ? 0 : Math.round((row.original.progress.scored / row.original.progress.total) * 100)} />
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
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => openReminderPreflight(row.original)}>Remind</Button>
          <Button size="sm" variant="secondary" onClick={() => setEditing(row.original)}>Edit</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setPendingDelete(row.original)}>Delete</Button>
        </span>
      ),
    },
  // The row callbacks read current component state; the columns only need to be
  // rebuilt when the vocabulary or the busy flag changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [trackName, busy, timezone]);

  return (
    <div className="page">
      <PageHeader
        eyebrow="REVIEW"
        title="Evaluation"
        description="Scoring rounds, who reviews which tracks, and how far each round has got."
        actions={
          <>
            <Button variant="secondary" onClick={() => setInviting(true)}><UserPlus size={16} /> Invite reviewer{pendingReviewerInvitations.length > 0 ? ` · ${pendingReviewerInvitations.length} pending` : ""}</Button>
            <Button onClick={() => setCreating(true)}><Plus size={16} /> New evaluation plan</Button>
          </>
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
          timezone={timezone}
          onClose={() => { setCreating(false); setEditing(null); }}
        />
      )}

      {assigning && <AssignmentDrawer eventId={eventId} plan={assigning} onClose={() => setAssigning(null)} />}
      {inviting && <ReviewerInviteDialog eventId={eventId} initialPendingInvitations={pendingReviewerInvitations} timezone={timezone} onClose={() => setInviting(false)} />}

      <ConfirmDialog
        open={reminderDialog !== null}
        title={`Remind reviewers for ${reminderDialog?.plan.name ?? "this round"}?`}
        body={<ReminderPreflight
          preview={reminderDialog?.preview ?? null}
          loading={reminderDialog?.previewing ?? false}
          previewError={reminderDialog?.previewError ?? ""}
          sendError={reminderDialog?.sendError ?? ""}
          onRetry={() => { if (reminderDialog) void loadReminderPreview(reminderDialog.plan); }}
        />}
        confirmLabel="Send reminders"
        variant="primary"
        confirmDisabled={busy || reminderDialog?.previewing !== false || !reminderDialog?.preview || reminderDialog.preview.length === 0 || Boolean(reminderDialog.previewError)}
        wide
        onConfirm={sendReminders}
        onCancel={closeReminderPreflight}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Delete ${pendingDelete?.name ?? "this evaluation plan"}?`}
        body="This permanently removes the round and its reviewer assignments. Rounds with completed reviews cannot be deleted."
        confirmLabel="Delete plan"
        onConfirm={async () => {
          if (!pendingDelete) return;
          await remove(pendingDelete);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

function ReminderPreflight({
  preview,
  loading,
  previewError,
  sendError,
  onRetry,
}: {
  preview: ReminderRecipient[] | null;
  loading: boolean;
  previewError: string;
  sendError: string;
  onRetry: () => void;
}) {
  if (loading) return <p role="status">Checking who still has reviews to finish…</p>;
  if (previewError) {
    return <div className="form-stack" role="alert">
      <p>{previewError}</p>
      <Button variant="secondary" onClick={onRetry}>Retry preview</Button>
    </div>;
  }
  if (!preview) return <p role="status">A fresh recipient preview is required before reminders can be sent.</p>;
  if (preview.length === 0) return <p>Nobody on this round has outstanding work.</p>;
  return <div className="form-stack">
    <p><b>{preview.length} reviewer{preview.length === 1 ? "" : "s"} will be reminded</b></p>
    <ul className="reviewer-progress">
      {preview.map((recipient) => (
        <li key={recipient.reviewerUserId}>
          <b>{recipient.name || recipient.email}</b>{recipient.name ? ` · ${recipient.email}` : ""}
          <small>{recipient.outstanding} outstanding proposal{recipient.outstanding === 1 ? "" : "s"}</small>
        </li>
      ))}
    </ul>
    <p className="portal-note">The server checks outstanding work again when you send, so reviewers who finish meanwhile will not be emailed.</p>
    {sendError && <p className="form-error" role="alert">{sendError}</p>}
  </div>;
}
