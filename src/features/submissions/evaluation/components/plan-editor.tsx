"use client";

import { Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CriterionKind } from "@/shared/contracts";
import { DateTimePicker } from "@/shared/ui/app/datetime-picker";
import { editorDraftChanged, requestGuardedEditorClose } from "@/shared/ui/app/modal-editor-guard";
import { useGuardedAction, useUnsavedWorkGuard } from "@/shared/ui/app/unsaved-work-guard";
import { Button, Drawer, Field, Select, Switch } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import { assignmentLockGuidance, assignmentLockReason, nextAssignmentLockRefreshMs } from "../assignment-writability";
import type { PlanDTO } from "../types";
import type { EventMember, TrackOption } from "./plans-view";
import { evaluationFailureMessage, evaluationRequest, type EvaluationRequestResult } from "./evaluation-request";

/**
 * Creating and editing a round. Rounds are ordered plans rather than a state
 * machine: Round 2 is a new plan with a narrower scope, and the organizer moves
 * survivors into it from Abstracts by rating. The drawer says so, because the
 * alternative is an organizer looking for an "advance round" button that will
 * never exist.
 */

type CriterionDraft = {
  id: string | null;
  label: string;
  weight: number;
  kind: CriterionKind;
  required: boolean;
  /** `label:score` per line; a line with no score is recorded but never averaged. */
  optionsText: string;
};

type PlanDraft = {
  name: string;
  round: number;
  scaleMin: number;
  scaleMax: number;
  status: PlanDTO["status"];
  /** Empty is "every track" — the server stores that as NULL. */
  trackIds: string[];
  /** UTC instants, as the contract speaks them; null is unbounded on that side. */
  opensAt: string | null;
  closesAt: string | null;
  anonymizeAuthors: boolean;
  showPeerScores: boolean;
  criteria: CriterionDraft[];
  reviewers: Array<{ userId: string; trackIds: string[] }>;
};

const emptyDraft = (nextRound: number): PlanDraft => ({
  name: "",
  round: nextRound,
  scaleMin: 1,
  scaleMax: 5,
  status: "open",
  trackIds: [],
  opensAt: null,
  closesAt: null,
  anonymizeAuthors: false,
  showPeerScores: false,
  criteria: [],
  reviewers: [],
});

function optionsToText(options: PlanDTO["criteria"][number]["options"]): string {
  return options.map((option) => option.score === null ? option.label : `${option.label}:${option.score}`).join("\n");
}

/**
 * Parsed on save, never on every keystroke — an organizer mid-way through
 * typing "Strong:" should not see their option vanish and reappear.
 */
function parseOptions(text: string, existing: PlanDTO["criteria"][number]["options"]): PlanDTO["criteria"][number]["options"] {
  return text.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const separator = line.lastIndexOf(":");
    const label = separator === -1 ? line : line.slice(0, separator).trim();
    const rawScore = separator === -1 ? "" : line.slice(separator + 1).trim();
    const score = rawScore === "" ? null : Number(rawScore);
    const previous = existing.find((option) => option.label === label);
    return {
      id: previous?.id ?? (label.toLowerCase().replace(/[^a-z0-9]+/gu, "_").replace(/^_+|_+$/gu, "") || crypto.randomUUID()),
      label,
      score: score === null || Number.isNaN(score) ? null : score,
    };
  });
}

/**
 * The server's rule for a criterion's weight (`positive().max(100)`), stated
 * where it is typed. Without it the only feedback on a 0 is a round trip
 * answering "Request validation failed", which names neither the field nor the
 * criterion — with a dozen inputs on screen the organizer has to guess.
 */
export function criterionWeightError(criterion: Pick<CriterionDraft, "kind" | "weight">): string | undefined {
  if (criterion.kind === "text") return undefined;
  const valid = Number.isFinite(criterion.weight) && criterion.weight > 0 && criterion.weight <= 100;
  return valid ? undefined : "Weight has to be above 0 and at most 100 — it is relative, so 2 counts twice as much as 1";
}

/**
 * The server applies its weight rule to every kind, but the Weight input is
 * disabled for written feedback, so a value it would refuse can only be left
 * over from the type the criterion was switched away from — and the organizer
 * has no field to fix it in. Send the neutral 1 instead of collecting a 400.
 */
export function outgoingCriterionWeight(criterion: Pick<CriterionDraft, "kind" | "weight">): number {
  if (criterion.kind !== "text") return criterion.weight;
  return criterionWeightError({ kind: "numeric", weight: criterion.weight }) ? 1 : criterion.weight;
}

function draftFrom(plan: PlanDTO): PlanDraft {
  return {
    name: plan.name,
    round: plan.round,
    scaleMin: plan.scaleMin,
    scaleMax: plan.scaleMax,
    status: plan.status,
    trackIds: plan.trackIds ?? [],
    opensAt: plan.opensAt,
    closesAt: plan.closesAt,
    anonymizeAuthors: plan.anonymizeAuthors,
    showPeerScores: plan.showPeerScores,
    criteria: plan.criteria.map((criterion) => ({
      id: criterion.id as string,
      label: criterion.label,
      weight: criterion.weight,
      kind: criterion.kind,
      required: criterion.required,
      optionsText: optionsToText(criterion.options),
    })),
    reviewers: plan.reviewers.map((reviewer) => ({ userId: reviewer.userId as string, trackIds: reviewer.trackIds ?? [] })),
  };
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function sameReviewerAssignments(
  left: readonly PlanDraft["reviewers"][number][],
  right: readonly PlanDraft["reviewers"][number][],
): boolean {
  if (left.length !== right.length) return false;
  const rightByUser = new Map(right.map((reviewer) => [reviewer.userId, reviewer.trackIds]));
  return left.every((reviewer) => {
    const otherTracks = rightByUser.get(reviewer.userId);
    return otherTracks !== undefined && sameStringSet(reviewer.trackIds, otherTracks);
  });
}

function sameCriteriaDrafts(left: readonly CriterionDraft[], right: readonly CriterionDraft[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Rebase a mounted editor after router.refresh supplies a newer authoritative
 * plan. Fields the organizer has not touched follow the server; local edits
 * stay local and are now protected by the fresh optimistic revision.
 */
function rebaseDraft(
  current: PlanDraft,
  previous: PlanDraft,
  latest: PlanDraft,
): PlanDraft {
  return {
    name: current.name === previous.name ? latest.name : current.name,
    round: current.round === previous.round ? latest.round : current.round,
    scaleMin: current.scaleMin === previous.scaleMin ? latest.scaleMin : current.scaleMin,
    scaleMax: current.scaleMax === previous.scaleMax ? latest.scaleMax : current.scaleMax,
    status: current.status === previous.status ? latest.status : current.status,
    trackIds: sameStringSet(current.trackIds, previous.trackIds) ? latest.trackIds : current.trackIds,
    opensAt: current.opensAt === previous.opensAt ? latest.opensAt : current.opensAt,
    closesAt: current.closesAt === previous.closesAt ? latest.closesAt : current.closesAt,
    anonymizeAuthors: current.anonymizeAuthors === previous.anonymizeAuthors
      ? latest.anonymizeAuthors
      : current.anonymizeAuthors,
    showPeerScores: current.showPeerScores === previous.showPeerScores
      ? latest.showPeerScores
      : current.showPeerScores,
    criteria: sameCriteriaDrafts(current.criteria, previous.criteria) ? latest.criteria : current.criteria,
    reviewers: sameReviewerAssignments(current.reviewers, previous.reviewers) ? latest.reviewers : current.reviewers,
  };
}

function assignmentWindowBlockers(
  window: Pick<PlanDTO, "status" | "closesAt">,
  now: Date,
): number {
  return Number(window.status !== "open")
    + Number(window.closesAt !== null && new Date(window.closesAt).getTime() <= now.getTime());
}

/** Recovery can require both reopening and extending a round. Let either
 * deliberate edit remove one blocker, but never let an ordinary edit move
 * unsaved assignments toward a terminal window. */
function canStageReviewerRecovery(
  current: Pick<PlanDTO, "status" | "closesAt">,
  next: Pick<PlanDTO, "status" | "closesAt">,
  now: Date,
  recoveryLoaded: boolean,
): boolean {
  return recoveryLoaded && assignmentWindowBlockers(next, now) < assignmentWindowBlockers(current, now);
}

/** A `<Select multiple>` of tracks, where selecting nothing means every track. */
function TrackScope({
  tracks,
  value,
  onChange,
  label,
  disabled = false,
}: {
  tracks: TrackOption[];
  value: string[];
  onChange: (next: string[]) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <Field label={label} hint="Select none for every track">
      <Select
        multiple
        value={value}
        size={Math.min(tracks.length, 4)}
        disabled={disabled}
        onChange={(event) => onChange(Array.from(event.target.selectedOptions, (option) => option.value))}
      >
        {tracks.map((track) => <option key={track.id} value={track.id}>{track.name}</option>)}
      </Select>
    </Field>
  );
}

export type PlanReviewerSaveResult =
  | { ok: true; planId: string; plan: PlanDTO | null }
  | {
      ok: false;
      kind: "response" | "transport";
      message: string;
      code?: string;
      pendingReviewerPlanId: string | null;
    };

/** Two-stage round saves can be retried safely: once the round write succeeds,
 * its id is retained and later attempts run only the reviewer replacement.
 *
 * Both writes answer with the round they produced. The later one wins, and a
 * retry that skips the round write still comes back whole through the reviewer
 * response — so the caller always has the round as it now stands, or an honest
 * null when neither write was in a position to say. */
export async function completePlanAndReviewerSave(
  pendingReviewerPlanId: string | null,
  savePlan: () => Promise<EvaluationRequestResult<{ planId: string; plan?: PlanDTO }>>,
  saveReviewers: (planId: string) => Promise<EvaluationRequestResult<{ plan?: PlanDTO }>>,
): Promise<PlanReviewerSaveResult> {
  const planResult = pendingReviewerPlanId
    ? { ok: true as const, data: { planId: pendingReviewerPlanId, plan: undefined } }
    : await savePlan();
  if (!planResult.ok) return { ...planResult, pendingReviewerPlanId: null };

  const reviewerResult = await saveReviewers(planResult.data.planId);
  return reviewerResult.ok
    ? { ok: true, planId: planResult.data.planId, plan: reviewerResult.data.plan ?? planResult.data.plan ?? null }
    : { ...reviewerResult, pendingReviewerPlanId: planResult.data.planId };
}

export function PlanEditor({
  eventId,
  plan,
  tracks,
  members,
  nextRound,
  timezone,
  onSaved,
  onClose,
}: {
  eventId: string;
  /** Null when creating; the round being edited otherwise. */
  plan: PlanDTO | null;
  tracks: TrackOption[];
  members: EventMember[];
  nextRound: number;
  /** The event's zone. A round window is read and written in it, never in the organizer's. */
  timezone: string;
  /** The round as the write left it, so the list behind this drawer agrees with the toast. */
  onSaved: (plan: PlanDTO) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [baseline, setBaseline] = useState<PlanDraft>(() => plan ? draftFrom(plan) : emptyDraft(nextRound));
  const [draft, setDraft] = useState<PlanDraft>(baseline);
  const [createPlanId] = useState(() => plan?.id ?? crypto.randomUUID());
  const [persistedPlanId, setPersistedPlanId] = useState<string | null>(plan?.id ?? null);
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState(plan?.updatedAt);
  const [loadedLatestPlan, setLoadedLatestPlan] = useState<PlanDTO | null>(null);
  const [windowEditRevision, setWindowEditRevision] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingLatest, setLoadingLatest] = useState(false);
  const [pendingReviewerPlanId, setPendingReviewerPlanId] = useState<string | null>(null);
  const [reviewerLockConflict, setReviewerLockConflict] = useState(false);
  const [reviewerRecoveryLoaded, setReviewerRecoveryLoaded] = useState(false);
  const [assignmentNowMs, setAssignmentNowMs] = useState(() => Date.now());
  const baselineRef = useRef(baseline);
  baselineRef.current = baseline;
  const expectedUpdatedAtRef = useRef(expectedUpdatedAt);
  expectedUpdatedAtRef.current = expectedUpdatedAt;
  const { runGuarded } = useGuardedAction();
  const authoritativePlan = loadedLatestPlan && (!plan || new Date(loadedLatestPlan.updatedAt) >= new Date(plan.updatedAt))
    ? loadedLatestPlan
    : plan;
  const assignmentWindow = !authoritativePlan || windowEditRevision === authoritativePlan.updatedAt
    ? draft
    : authoritativePlan;
  const dirty = pendingReviewerPlanId !== null || editorDraftChanged(draft, baseline);
  const reviewerAssignmentsChanged = !sameReviewerAssignments(draft.reviewers, baseline.reviewers);
  const trackScopeChanged = !sameStringSet(draft.trackIds, baseline.trackIds);
  const assignmentEditsChanged = reviewerAssignmentsChanged || trackScopeChanged;
  const assignmentLock = assignmentLockReason(assignmentWindow, new Date(assignmentNowMs));
  const assignmentGuidance = assignmentLock ? assignmentLockGuidance(assignmentLock) : null;
  const reviewerRecoveryRequired = pendingReviewerPlanId !== null
    && (reviewerLockConflict || assignmentLock !== null);
  const assignmentSaveBlocked = assignmentEditsChanged && assignmentLock !== null;
  const criteriaInvalid = draft.criteria.some((criterion) => criterionWeightError(criterion) !== undefined);
  /**
   * The round's arithmetic is frozen from the first review onwards — see
   * `assertScoringShapeEditable`, which answers a 409 to any edit of the scale,
   * the set of criteria, or a criterion's kind, weight, bounds or option
   * scores. The organizer used to find that out only after filling the fields
   * in and pressing Save. Labels and the required flag stay editable, because
   * the server takes them: a criterion may be reworded without re-valuing a
   * single stored verdict.
   */
  const scoringLocked = authoritativePlan?.hasReviews === true;

  useUnsavedWorkGuard(dirty);

  useEffect(() => {
    if (!plan) return;
    const currentRevision = expectedUpdatedAtRef.current;
    if (currentRevision && new Date(plan.updatedAt) <= new Date(currentRevision)) return;

    const latest = draftFrom(plan);
    const previous = baselineRef.current;
    setDraft((current) => rebaseDraft(current, previous, latest));
    setBaseline(latest);
    setExpectedUpdatedAt(plan.updatedAt);
    setWindowEditRevision((revision) => revision === null ? null : plan.updatedAt);
  }, [plan]);

  useEffect(() => {
    let timer: number | null = null;
    const refreshLock = () => {
      const nowMs = Date.now();
      setAssignmentNowMs(nowMs);
      const delay = nextAssignmentLockRefreshMs([{ status: assignmentWindow.status, closesAt: assignmentWindow.closesAt }], nowMs);
      if (delay !== null) timer = window.setTimeout(refreshLock, delay);
    };
    refreshLock();
    return () => { if (timer !== null) window.clearTimeout(timer); };
  }, [assignmentWindow.closesAt, assignmentWindow.status]);

  const patch = (next: Partial<PlanDraft>) => setDraft((current) => ({ ...current, ...next }));

  function refuseTerminalAssignmentEdits(): void {
    toast("Save assignment changes while the round is open, then close it in a separate edit", { kind: "error" });
  }

  function changeStatus(status: PlanDTO["status"]): void {
    const nextWindow = { status, closesAt: assignmentWindow.closesAt };
    const now = new Date(assignmentNowMs);
    if (
      assignmentEditsChanged
      && assignmentLockReason(nextWindow, now)
      && !canStageReviewerRecovery(assignmentWindow, nextWindow, now, reviewerRecoveryLoaded)
    ) {
      refuseTerminalAssignmentEdits();
      return;
    }
    setWindowEditRevision(authoritativePlan?.updatedAt ?? "local");
    patch(nextWindow);
  }

  function changeClosesAt(closesAt: string | null): void {
    const nextWindow = { status: assignmentWindow.status, closesAt };
    const now = new Date(assignmentNowMs);
    if (
      assignmentEditsChanged
      && assignmentLockReason(nextWindow, now)
      && !canStageReviewerRecovery(assignmentWindow, nextWindow, now, reviewerRecoveryLoaded)
    ) {
      refuseTerminalAssignmentEdits();
      return;
    }
    setWindowEditRevision(authoritativePlan?.updatedAt ?? "local");
    patch(nextWindow);
  }

  function closeEditor() {
    requestGuardedEditorClose({ busy: saving || loadingLatest, dirty, runGuarded, close: onClose });
  }

  async function loadLatestRound() {
    if (!pendingReviewerPlanId || loadingLatest) return;
    setLoadingLatest(true);
    try {
      const result = await evaluationRequest<{ plans: PlanDTO[] }>(
        `/api/internal/evaluation/${eventId}/plans`,
        { method: "GET" },
        "The latest round could not be loaded",
      );
      if (!result.ok) {
        toast(evaluationFailureMessage(result), { kind: "error" });
        return;
      }
      const latest = result.data.plans.find((candidate) => candidate.id === pendingReviewerPlanId);
      if (!latest) {
        toast("This round no longer exists", { kind: "error" });
        return;
      }
      const latestBaseline = draftFrom(latest);
      setBaseline(latestBaseline);
      setDraft((current) => ({ ...latestBaseline, reviewers: current.reviewers }));
      setPersistedPlanId(latest.id);
      setExpectedUpdatedAt(latest.updatedAt);
      setLoadedLatestPlan(latest);
      setWindowEditRevision(null);
      setPendingReviewerPlanId(null);
      setReviewerLockConflict(false);
      setReviewerRecoveryLoaded(true);
    } finally {
      setLoadingLatest(false);
    }
  }

  async function save() {
    if (assignmentEditsChanged && assignmentLockReason(assignmentWindow)) {
      refuseTerminalAssignmentEdits();
      return;
    }
    setReviewerRecoveryLoaded(false);
    setSaving(true);
    try {
      const body = {
        ...(!persistedPlanId ? { planId: createPlanId } : {}),
        name: draft.name,
        round: draft.round,
        scaleMin: draft.scaleMin,
        scaleMax: draft.scaleMax,
        status: assignmentWindow.status,
        // Empty means every track, which the server stores as NULL.
        trackIds: draft.trackIds.length === 0 ? null : draft.trackIds,
        opensAt: draft.opensAt,
        closesAt: assignmentWindow.closesAt,
        anonymizeAuthors: draft.anonymizeAuthors,
        showPeerScores: draft.showPeerScores,
        criteria: draft.criteria.map((criterion) => ({
          id: criterion.id,
          label: criterion.label,
          weight: outgoingCriterionWeight(criterion),
          kind: criterion.kind,
          required: criterion.required,
          options: criterion.kind === "select"
            ? parseOptions(criterion.optionsText, authoritativePlan?.criteria.find((entry) => entry.id === criterion.id)?.options ?? [])
            : [],
        })),
        // Optimistic concurrency, so a second organizer's edit is a conflict
        // the first one sees rather than an overwrite they never learn about.
        ...(persistedPlanId ? { expectedUpdatedAt } : {}),
      };
      const result = await completePlanAndReviewerSave(
        pendingReviewerPlanId,
        () => evaluationRequest<{ planId: string; plan?: PlanDTO }>(
          persistedPlanId ? `/api/internal/evaluation/${eventId}/plans/${persistedPlanId}` : `/api/internal/evaluation/${eventId}/plans`,
          { method: persistedPlanId ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
          "That round did not save",
        ),
        // The reviewer replacement answers with the whole round rather than a
        // wrapper; naming it `plan` here is what lets either write be the one
        // that reports the round back.
        (savedPlanId) => reviewerAssignmentsChanged
          ? evaluationRequest<PlanDTO>(`/api/internal/evaluation/${eventId}/plans/${savedPlanId}/reviewers`, {
              method: "PUT",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                reviewers: draft.reviewers.map((reviewer) => ({
                  userId: reviewer.userId,
                  trackIds: reviewer.trackIds.length === 0 ? null : reviewer.trackIds,
                })),
              }),
            }, "The round saved, but its reviewers did not")
              .then((result) => result.ok ? { ok: true as const, data: { plan: result.data } } : result)
          : Promise.resolve({ ok: true as const, data: {} }),
      );
      if (!result.ok) {
        setPendingReviewerPlanId(result.pendingReviewerPlanId);
        setReviewerLockConflict(Boolean(result.pendingReviewerPlanId && result.code === "CONFLICT"));
        toast(evaluationFailureMessage(result), { kind: "error" });
        if (result.pendingReviewerPlanId) router.refresh();
        return;
      }
      // Same bargain as the assignment drawer: the round the write produced
      // reaches the list now, and the refresh below is free to overwrite it
      // with the next server snapshot.
      if (result.plan) onSaved(result.plan);
      toast(persistedPlanId ? `${draft.name} updated` : `${draft.name} created`);
      onClose();
      router.refresh();
    } catch {
      toast("That round did not save — check your connection and try again", { kind: "error" });
    } finally {
      setSaving(false);
    }
  }

  const toggleReviewer = (userId: string) => setDraft((current) => ({
    ...current,
    reviewers: current.reviewers.some((reviewer) => reviewer.userId === userId)
      ? current.reviewers.filter((reviewer) => reviewer.userId !== userId)
      : [...current.reviewers, { userId, trackIds: [] }],
  }));

  return (
    <Drawer open onClose={closeEditor} title={persistedPlanId ? `Edit ${plan?.name ?? draft.name}` : "New evaluation plan"}>
      <div className="form-stack drawer-body">
        {pendingReviewerPlanId && (
          <div className="portal-note" role="alert">
            {reviewerRecoveryRequired ? (
              <>
                <p><b>Round details are saved, but assignments are now locked.</b> Load the latest round, then reopen it or extend its close date before saving your preserved reviewer changes.</p>
                <Button size="sm" variant="secondary" disabled={loadingLatest} onClick={loadLatestRound}>
                  {loadingLatest ? "Loading latest…" : "Load latest round"}
                </Button>
              </>
            ) : (
              <p><b>Round details are saved.</b> Reviewer assignment is still pending. The saved details are locked below; update the reviewer choices, then retry.</p>
            )}
          </div>
        )}
        {reviewerRecoveryLoaded && (
          <p className="portal-note" role="status">
            <b>Latest round loaded.</b> Your reviewer changes are preserved. {assignmentGuidance ?? "Save again to apply them."}
          </p>
        )}
        <fieldset disabled={pendingReviewerPlanId !== null} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: "contents" }}>
        <Field label="Round name" required>
          <input required value={draft.name} onChange={(event) => patch({ name: event.target.value })} placeholder="e.g. Round 1 · Program committee" />
        </Field>

        <div className="evaluation-field-row evaluation-number-row">
          <Field label="Round">
            <input type="number" min={1} value={draft.round} onChange={(event) => patch({ round: Number(event.target.value) })} />
          </Field>
          <Field label="Scale low">
            <input type="number" min={0} value={draft.scaleMin} disabled={scoringLocked} onChange={(event) => patch({ scaleMin: Number(event.target.value) })} />
          </Field>
          <Field label="Scale high">
            <input type="number" min={1} value={draft.scaleMax} disabled={scoringLocked} onChange={(event) => patch({ scaleMax: Number(event.target.value) })} />
          </Field>
        </div>
        {scoringLocked && (
          <p className="portal-note" role="status">
            <b>This round has been scored, so its scale and criteria are fixed.</b> Every stored score was worked out
            with them and is never recalculated. Renaming a criterion or changing whether it is required still saves;
            for a different scale or a different set of criteria, create the next round.
          </p>
        )}

        <TrackScope
          label="Track scope"
          tracks={tracks}
          value={draft.trackIds}
          disabled={assignmentLock !== null}
          onChange={(trackIds) => patch({ trackIds })}
        />
        {assignmentGuidance && (
          <p className="portal-note" role="status">Track and reviewer assignments are locked. {assignmentGuidance}</p>
        )}

        <div className="evaluation-field-row evaluation-window-row">
          <Field label="Opens" hint="Reviewers cannot open assigned submissions before this">
            <DateTimePicker value={draft.opensAt} onChange={(opensAt) => patch({ opensAt })} tz={timezone} />
          </Field>
          <Field label="Closes" hint="Saving stops at this moment; prior work stays readable">
            <DateTimePicker value={assignmentWindow.closesAt} onChange={changeClosesAt} tz={timezone} />
          </Field>
        </div>

        <div className="inline-setting">
          <div>
            <b>Blind review</b>
            <small>Hide author, co-authors and every answer not marked as submission content in the form builder.</small>
          </div>
          <Switch
            label="Blind review"
            checked={draft.anonymizeAuthors}
            onClick={() => patch({ anonymizeAuthors: !draft.anonymizeAuthors })}
          />
        </div>

        <div className="inline-setting">
          <div>
            <b>Share committee averages</b>
            <small>Off keeps scores independent. Turn this on only when reviewers should calibrate against the live committee mean.</small>
          </div>
          <Switch
            label="Share committee averages with reviewers"
            checked={draft.showPeerScores}
            onClick={() => patch({ showPeerScores: !draft.showPeerScores })}
          />
        </div>

        <Field label="Status">
          <Select value={assignmentWindow.status} onChange={(event) => changeStatus(event.target.value === "closed" ? "closed" : "open")}>
            <option value="open">Open — reviewers can score</option>
            <option value="closed">Closed — scores are final</option>
          </Select>
        </Field>

        <section>
          <h3>Criteria</h3>
          <p className="portal-note">
            With no criteria a reviewer gives one score. With criteria they answer each; numbers and scored choices make the
            weighted mean, written feedback never does, and a review counts as finished once every required criterion is answered.
          </p>
          {scoringLocked && (
            <p className="portal-note" role="status">
              This round has been scored: labels and the required flag are still yours to change, the rest of a criterion is not.
            </p>
          )}
          {draft.criteria.map((criterion, index) => {
            const weightError = criterionWeightError(criterion);
            const weightErrorId = `evaluation-criterion-weight-error-${criterion.id ?? `new-${index}`}`;
            return (
              <div className="evaluation-field-row evaluation-criterion-row" key={criterion.id ?? `new-${index}`}>
                <Field label="Label">
                  <input
                    value={criterion.label}
                    onChange={(event) => patch({
                      criteria: draft.criteria.map((entry, position) => position === index ? { ...entry, label: event.target.value } : entry),
                    })}
                  />
                </Field>
                <Field label="Type">
                  <Select
                    value={criterion.kind}
                    disabled={scoringLocked}
                    onChange={(event) => patch({
                      criteria: draft.criteria.map((entry, position) => position === index ? { ...entry, kind: event.target.value as CriterionKind } : entry),
                    })}
                  >
                    <option value="numeric">Number on the scale</option>
                    <option value="select">Choice</option>
                    <option value="text">Written feedback</option>
                  </Select>
                </Field>
                <Field
                  label="Weight"
                  error={weightError}
                  errorId={weightErrorId}
                  {...(criterion.kind === "text" ? { hint: "Written feedback never enters the mean" } : {})}
                >
                  <input
                    // The disabled input shows what will actually be sent, not
                    // the stale value left over from the kind the criterion was
                    // switched away from: a written-feedback row displaying 0
                    // while the payload carries the normalized 1 is the UI
                    // narrating a number the server never receives.
                    type="number" min={1} max={100} step={1} value={outgoingCriterionWeight(criterion)} disabled={scoringLocked || criterion.kind === "text"}
                    aria-invalid={weightError ? true : undefined}
                    aria-describedby={weightError ? weightErrorId : undefined}
                    onChange={(event) => patch({
                      criteria: draft.criteria.map((entry, position) => position === index ? { ...entry, weight: Number(event.target.value) } : entry),
                    })}
                  />
                </Field>
                <Field label="Required">
                  <input
                    type="checkbox" checked={criterion.required}
                    aria-label={`${criterion.label || "Criterion"} is required`}
                    onChange={(event) => patch({
                      criteria: draft.criteria.map((entry, position) => position === index ? { ...entry, required: event.target.checked } : entry),
                    })}
                  />
                </Field>
                <Button
                  variant="ghost"
                  disabled={scoringLocked}
                  aria-label={`Remove ${criterion.label || "criterion"}`}
                  onClick={() => patch({ criteria: draft.criteria.filter((_, position) => position !== index) })}
                >
                  <Trash2 size={15} />
                </Button>
                {criterion.kind === "select" && (
                  <Field label="Choices" hint="One per line as “Label:score”. Leave the score off for a choice that is recorded but never averaged.">
                    <textarea
                      value={criterion.optionsText}
                      disabled={scoringLocked}
                      onChange={(event) => patch({
                        criteria: draft.criteria.map((entry, position) => position === index ? { ...entry, optionsText: event.target.value } : entry),
                      })}
                      placeholder={"Strong accept:5\nAccept:4\nNot applicable"}
                    />
                  </Field>
                )}
              </div>
            );
          })}
          <Button variant="secondary" disabled={scoringLocked} onClick={() => patch({ criteria: [...draft.criteria, { id: null, label: "", weight: 1, kind: "numeric", required: true, optionsText: "" }] })}>
            <Plus size={15} /> Add criterion
          </Button>
        </section>
        </fieldset>

        <section>
          <h3>Reviewers</h3>
          <fieldset disabled={saving || assignmentLock !== null} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            <legend className="sr-only">Reviewer assignments</legend>
            {members.length === 0 ? (
              <p className="portal-note">This event has no members to assign yet.</p>
            ) : members.map((member) => {
              const assignment = draft.reviewers.find((reviewer) => reviewer.userId === member.userId);
              return (
                <div key={member.userId} className="reviewer-assignment">
                  <label>
                    <input type="checkbox" checked={Boolean(assignment)} onChange={() => toggleReviewer(member.userId)} />
                    <b>{member.name || member.email}</b> <small>{member.role}</small>
                  </label>
                  {assignment && (
                    <TrackScope
                      label={`Tracks for ${member.name || member.email}`}
                      tracks={tracks}
                      value={assignment.trackIds}
                      onChange={(trackIds) => patch({
                        reviewers: draft.reviewers.map((reviewer) => reviewer.userId === member.userId ? { ...reviewer, trackIds } : reviewer),
                      })}
                    />
                  )}
                </div>
              );
            })}
          </fieldset>
        </section>

        <p className="portal-note">
          Rounds are ordered plans — to run a second one, create it with a narrower scope, then sort Submissions by rating and move the survivors.
        </p>
        <div className="drawer-actions">
          <Button variant="secondary" disabled={saving || loadingLatest} onClick={closeEditor}>Cancel</Button>
          <Button disabled={saving || loadingLatest || reviewerRecoveryRequired || assignmentSaveBlocked || criteriaInvalid || draft.name.trim() === ""} onClick={save}>
            {saving ? "Saving…" : reviewerRecoveryRequired ? "Load latest to continue" : pendingReviewerPlanId ? "Retry reviewer assignments" : persistedPlanId ? "Save round" : "Create round"}
          </Button>
        </div>
      </div>
    </Drawer>
  );
}
