"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatCode } from "@/features/submissions/index.client";
import { ConfirmDialog } from "@/shared/ui/app/confirm-dialog";
import { requestGuardedEditorClose } from "@/shared/ui/app/modal-editor-guard";
import { useGuardedAction, useUnsavedWorkGuard } from "@/shared/ui/app/unsaved-work-guard";
import { Button, Drawer, Field, Select } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import type { AssignableSubmission, PlanDTO } from "../types";
import { evaluationFailureMessage, evaluationRequest } from "./evaluation-request";

type AssignmentMode = "add" | "replace";

export function canSubmitAssignments({
  loaded,
  hasLoadError,
  busy,
  reviewerCount,
  selectedCount,
  mode,
  currentAssignmentCount,
}: {
  loaded: boolean;
  hasLoadError: boolean;
  busy: boolean;
  reviewerCount: number;
  selectedCount: number;
  mode: AssignmentMode;
  currentAssignmentCount: number;
}) {
  if (!loaded || hasLoadError || busy || reviewerCount === 0) return false;
  if (selectedCount > 0) return true;
  return mode === "replace" && currentAssignmentCount > 0;
}

export function needsEmptyReplacementConfirmation({
  mode,
  selectedCount,
  currentAssignmentCount,
}: {
  mode: AssignmentMode;
  selectedCount: number;
  currentAssignmentCount: number;
}) {
  return mode === "replace" && selectedCount === 0 && currentAssignmentCount > 0;
}

export function keepShownAssignmentSelection(selectedIds: readonly string[], shownIds: readonly string[]) {
  const shown = new Set(shownIds);
  return selectedIds.filter((id) => shown.has(id));
}

function submissionsForTrack(submissions: readonly AssignableSubmission[], trackId: string) {
  return submissions.filter((submission) => trackId === "" || submission.trackId === trackId);
}

export function assignmentDraftChanged(input: {
  reviewerIds: readonly string[];
  submissionIds: readonly string[];
  mode: AssignmentMode;
}): boolean {
  return input.reviewerIds.length > 0 || input.submissionIds.length > 0 || input.mode !== "add";
}

/**
 * Handing work out.
 *
 * The reviewer's queue is exactly the rows this writes, so the dialog is
 * deliberately explicit rather than clever: pick reviewers, pick submissions,
 * choose whether this *adds* to their queues or *is* their queues. "Replace" is
 * the only way to take work back, and it is named so that nobody discovers that
 * by accident.
 */
export function AssignmentDrawer({
  eventId,
  plan,
  onClose,
}: {
  eventId: string;
  plan: PlanDTO;
  onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const targetKey = `${eventId}:${plan.id}`;
  const currentTargetRef = useRef(targetKey);
  currentTargetRef.current = targetKey;
  const [submissions, setSubmissions] = useState<AssignableSubmission[] | null>(null);
  const [loadedTarget, setLoadedTarget] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");
  const [reviewerIds, setReviewerIds] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [trackFilter, setTrackFilter] = useState("");
  const [mode, setMode] = useState<AssignmentMode>("add");
  const [busy, setBusy] = useState(false);
  const [confirmEmptyReplace, setConfirmEmptyReplace] = useState(false);
  const dirty = assignmentDraftChanged({ reviewerIds, submissionIds: selected, mode });
  useUnsavedWorkGuard(dirty);
  const { runGuarded } = useGuardedAction();

  function requestClose() {
    requestGuardedEditorClose({ busy, dirty, runGuarded, close: onClose });
  }

  useEffect(() => {
    let cancelled = false;
    setSubmissions(null);
    setLoadedTarget(null);
    setLoadError("");
    setReviewerIds([]);
    setSelected([]);
    setTrackFilter("");
    setMode("add");
    setBusy(false);
    setConfirmEmptyReplace(false);
    fetch(`/api/internal/evaluation/${eventId}/plans/${plan.id}/assignments`)
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as { data?: { submissions: AssignableSubmission[] }; error?: { message?: string } } | null;
        if (cancelled) return;
        if (!response.ok || !payload?.data) {
          setSubmissions(null);
          setLoadError(payload?.error?.message ?? "Could not load this round's submissions");
        } else {
          setLoadError("");
          setSubmissions(payload.data.submissions);
          setLoadedTarget(targetKey);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSubmissions(null);
          setLoadError("Could not load this round's submissions");
        }
      });
    return () => { cancelled = true; };
  }, [eventId, plan.id, targetKey]);

  const tracks = useMemo(() => {
    const seen = new Map<string, string>();
    for (const submission of submissions ?? []) {
      if (submission.trackId) seen.set(submission.trackId, submission.trackName ?? "Track");
    }
    return [...seen.entries()];
  }, [submissions]);

  const visible = useMemo(
    () => submissionsForTrack(submissions ?? [], trackFilter),
    [submissions, trackFilter],
  );

  const toggle = useCallback((list: string[], id: string) => (
    list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id]
  ), []);

  const selectedReviewers = plan.reviewers.filter((reviewer) => reviewerIds.includes(reviewer.userId));
  const currentAssignmentCount = selectedReviewers.reduce((total, reviewer) => total + reviewer.assigned, 0);
  const assignmentsLoaded = submissions !== null && loadedTarget === targetKey;
  const controlsDisabled = !assignmentsLoaded || Boolean(loadError) || busy;
  const canAssign = canSubmitAssignments({
    loaded: assignmentsLoaded,
    hasLoadError: Boolean(loadError),
    busy,
    reviewerCount: reviewerIds.length,
    selectedCount: selected.length,
    mode,
    currentAssignmentCount,
  });

  async function saveAssignments() {
    if (!submissions || loadError || loadedTarget !== targetKey) {
      toast("Wait until this round's submissions load before changing assignments", { kind: "error" });
      return false;
    }
    const saveTarget = targetKey;
    setBusy(true);
    try {
      const result = await evaluationRequest<{ assigned: number; removed: number }>(`/api/internal/evaluation/${eventId}/plans/${plan.id}/assignments`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reviewerUserIds: reviewerIds, submissionIds: selected, mode }),
      }, "Those assignments did not save");
      if (currentTargetRef.current !== saveTarget) return result.ok;
      if (!result.ok) {
        toast(evaluationFailureMessage(result), { kind: "error" });
        return false;
      }
      toast(`${result.data.assigned} assigned${result.data.removed > 0 ? `, ${result.data.removed} taken back` : ""}`);
      setConfirmEmptyReplace(false);
      onClose();
      router.refresh();
      return true;
    } catch {
      if (currentTargetRef.current === saveTarget) {
        toast("Those assignments did not save — check your connection and try again", { kind: "error" });
      }
      return false;
    } finally {
      if (currentTargetRef.current === saveTarget) setBusy(false);
    }
  }

  async function assign() {
    if (!submissions || loadError || loadedTarget !== targetKey) {
      toast("Wait until this round's submissions load before changing assignments", { kind: "error" });
      return;
    }
    if (!canAssign) return;
    if (needsEmptyReplacementConfirmation({ mode, selectedCount: selected.length, currentAssignmentCount })) {
      setConfirmEmptyReplace(true);
      return;
    }
    await saveAssignments();
  }

  const reviewerNames = selectedReviewers.map((reviewer) => reviewer.name || reviewer.email).join(", ");

  function changeTrackFilter(nextTrack: string) {
    const nextVisible = submissionsForTrack(submissions ?? [], nextTrack);
    setSelected((current) => keepShownAssignmentSelection(
      current,
      nextVisible.map((submission) => submission.submissionId),
    ));
    setTrackFilter(nextTrack);
  }

  const assignLabel = busy
    ? "Assigning…"
    : selected.length === 0 && mode === "replace"
      ? "Empty queues"
      : mode === "replace"
        ? `Replace queues with ${selected.length}`
        : `Assign ${selected.length}`;

  return (
    <>
      <Drawer open onClose={requestClose} title={`Assign work · ${plan.name}`}>
        <div className="form-stack drawer-body">
        {plan.reviewers.length === 0
          ? <p className="portal-note">Add reviewers to this round before assigning work to them.</p>
          : (
            <section>
              <h3>Reviewers</h3>
              {plan.reviewers.map((reviewer) => (
                <label key={reviewer.userId} className="assignment-choice">
                  <input
                    type="checkbox"
                    checked={reviewerIds.includes(reviewer.userId)}
                    disabled={controlsDisabled}
                    onChange={() => setReviewerIds((current) => toggle(current, reviewer.userId))}
                  />
                  <b>{reviewer.name || reviewer.email}</b>
                  <small>{reviewer.completed}/{reviewer.assigned} done{reviewer.recused > 0 ? ` · ${reviewer.recused} recused` : ""}</small>
                </label>
              ))}
            </section>
          )}

        <Field label="Filter by track" hint="Changing tracks clears selected submissions that are no longer shown.">
          <Select disabled={controlsDisabled} value={trackFilter} onChange={(event) => changeTrackFilter(event.target.value)}>
            <option value="">Every track in this round</option>
            {tracks.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </Select>
        </Field>

        <section>
          <h3>Submissions</h3>
          {loadError && <p className="portal-note" role="alert">{loadError}</p>}
          {!submissions && !loadError && <p className="portal-note">Loading this round&apos;s submissions…</p>}
          {submissions && visible.length === 0 && <p className="portal-note">No submissions match this filter.</p>}
          <span className="row-actions">
            <Button disabled={controlsDisabled} size="sm" variant="secondary" onClick={() => setSelected(visible.map((submission) => submission.submissionId))}>
              Select all shown
            </Button>
            <Button disabled={controlsDisabled} size="sm" variant="ghost" onClick={() => setSelected([])}>Clear</Button>
          </span>
          <p className="portal-note" role="status">
            {selected.length} submission{selected.length === 1 ? "" : "s"} selected from {visible.length} shown.
          </p>
          {visible.map((submission) => (
            <label key={submission.submissionId} className="assignment-choice">
              <input
                type="checkbox"
                checked={selected.includes(submission.submissionId)}
                disabled={controlsDisabled}
                onChange={() => setSelected((current) => toggle(current, submission.submissionId))}
              />
              <b>{formatCode(submission.code)} {submission.title}</b>
              <small>{submission.trackName ?? "Uncategorized"} · {submission.assignedTo.length} assigned</small>
            </label>
          ))}
        </section>

        <Field label="Mode">
          <Select disabled={controlsDisabled} value={mode} onChange={(event) => setMode(event.target.value === "replace" ? "replace" : "add")}>
            <option value="add">Add to the selected reviewers&apos; queues</option>
            <option value="replace">Replace their queues with exactly this selection</option>
          </Select>
        </Field>
        <p className="portal-note">
          Recusals are never undone by either mode — a reviewer who declared a conflict stays off that submission.
        </p>
          <div className="drawer-actions">
            <Button variant="secondary" disabled={busy} onClick={requestClose}>Cancel</Button>
            <Button disabled={!canAssign} onClick={assign}>
              {assignLabel}
            </Button>
          </div>
        </div>
      </Drawer>
      <ConfirmDialog
        key={targetKey}
        open={confirmEmptyReplace}
        title="Empty the selected reviewer queues?"
        body={`This removes ${currentAssignmentCount} live assignment${currentAssignmentCount === 1 ? "" : "s"} from ${reviewerNames}. Their queues will be empty.`}
        confirmLabel="Empty reviewer queues"
        onConfirm={async () => { await saveAssignments(); }}
        onCancel={() => setConfirmEmptyReplace(false)}
      />
    </>
  );
}
