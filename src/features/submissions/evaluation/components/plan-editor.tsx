"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CriterionKind } from "@/shared/contracts";
import { DateTimePicker } from "@/shared/ui/app/datetime-picker";
import { editorDraftChanged, requestGuardedEditorClose } from "@/shared/ui/app/modal-editor-guard";
import { useGuardedAction, useUnsavedWorkGuard } from "@/shared/ui/app/unsaved-work-guard";
import { Button, Drawer, Field, Select, Switch } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
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

/** A `<Select multiple>` of tracks, where selecting nothing means every track. */
function TrackScope({
  tracks,
  value,
  onChange,
  label,
}: {
  tracks: TrackOption[];
  value: string[];
  onChange: (next: string[]) => void;
  label: string;
}) {
  return (
    <Field label={label} hint="Select none for every track">
      <Select
        multiple
        value={value}
        size={Math.min(tracks.length, 4)}
        onChange={(event) => onChange(Array.from(event.target.selectedOptions, (option) => option.value))}
      >
        {tracks.map((track) => <option key={track.id} value={track.id}>{track.name}</option>)}
      </Select>
    </Field>
  );
}

export type PlanReviewerSaveResult =
  | { ok: true; planId: string }
  | { ok: false; kind: "response" | "transport"; message: string; pendingReviewerPlanId: string | null };

/** Two-stage round saves can be retried safely: once the round write succeeds,
 * its id is retained and later attempts run only the reviewer replacement. */
export async function completePlanAndReviewerSave(
  pendingReviewerPlanId: string | null,
  savePlan: () => Promise<EvaluationRequestResult<{ planId: string }>>,
  saveReviewers: (planId: string) => Promise<EvaluationRequestResult<unknown>>,
): Promise<PlanReviewerSaveResult> {
  const planResult = pendingReviewerPlanId
    ? { ok: true as const, data: { planId: pendingReviewerPlanId } }
    : await savePlan();
  if (!planResult.ok) return { ok: false, kind: planResult.kind, message: planResult.message, pendingReviewerPlanId: null };

  const reviewerResult = await saveReviewers(planResult.data.planId);
  return reviewerResult.ok
    ? { ok: true, planId: planResult.data.planId }
    : { ok: false, kind: reviewerResult.kind, message: reviewerResult.message, pendingReviewerPlanId: planResult.data.planId };
}

export function PlanEditor({
  eventId,
  plan,
  tracks,
  members,
  nextRound,
  timezone,
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
  onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [baseline] = useState<PlanDraft>(() => plan ? draftFrom(plan) : emptyDraft(nextRound));
  const [draft, setDraft] = useState<PlanDraft>(baseline);
  const [createPlanId] = useState(() => plan?.id ?? crypto.randomUUID());
  const [saving, setSaving] = useState(false);
  const [pendingReviewerPlanId, setPendingReviewerPlanId] = useState<string | null>(null);
  const { runGuarded } = useGuardedAction();
  const dirty = pendingReviewerPlanId !== null || editorDraftChanged(draft, baseline);

  useUnsavedWorkGuard(dirty);

  const patch = (next: Partial<PlanDraft>) => setDraft((current) => ({ ...current, ...next }));

  function closeEditor() {
    requestGuardedEditorClose({ busy: saving, dirty, runGuarded, close: onClose });
  }

  async function save() {
    setSaving(true);
    try {
      const body = {
        ...(!plan ? { planId: createPlanId } : {}),
        name: draft.name,
        round: draft.round,
        scaleMin: draft.scaleMin,
        scaleMax: draft.scaleMax,
        status: draft.status,
        // Empty means every track, which the server stores as NULL.
        trackIds: draft.trackIds.length === 0 ? null : draft.trackIds,
        opensAt: draft.opensAt,
        closesAt: draft.closesAt,
        anonymizeAuthors: draft.anonymizeAuthors,
        showPeerScores: draft.showPeerScores,
        criteria: draft.criteria.map((criterion) => ({
          id: criterion.id,
          label: criterion.label,
          weight: criterion.weight,
          kind: criterion.kind,
          required: criterion.required,
          options: criterion.kind === "select"
            ? parseOptions(criterion.optionsText, plan?.criteria.find((entry) => entry.id === criterion.id)?.options ?? [])
            : [],
        })),
        // Optimistic concurrency, so a second organizer's edit is a conflict
        // the first one sees rather than an overwrite they never learn about.
        ...(plan ? { expectedUpdatedAt: plan.updatedAt } : {}),
      };
      const result = await completePlanAndReviewerSave(
        pendingReviewerPlanId,
        () => evaluationRequest<{ planId: string }>(
          plan ? `/api/internal/evaluation/${eventId}/plans/${plan.id}` : `/api/internal/evaluation/${eventId}/plans`,
          { method: plan ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
          "That round did not save",
        ),
        (savedPlanId) => evaluationRequest<unknown>(`/api/internal/evaluation/${eventId}/plans/${savedPlanId}/reviewers`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            reviewers: draft.reviewers.map((reviewer) => ({
              userId: reviewer.userId,
              trackIds: reviewer.trackIds.length === 0 ? null : reviewer.trackIds,
            })),
          }),
        }, "The round saved, but its reviewers did not"),
      );
      if (!result.ok) {
        setPendingReviewerPlanId(result.pendingReviewerPlanId);
        toast(evaluationFailureMessage(result), { kind: "error" });
        if (result.pendingReviewerPlanId) router.refresh();
        return;
      }
      toast(plan ? `${draft.name} updated` : `${draft.name} created`);
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
    <Drawer open onClose={closeEditor} title={plan ? `Edit ${plan.name}` : "New evaluation plan"}>
      <div className="form-stack drawer-body">
        {pendingReviewerPlanId && (
          <p className="portal-note" role="alert">
            <b>Round details are saved.</b> Reviewer assignment is still pending. The saved details are locked below; update the reviewer choices, then retry.
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
            <input type="number" min={0} value={draft.scaleMin} onChange={(event) => patch({ scaleMin: Number(event.target.value) })} />
          </Field>
          <Field label="Scale high">
            <input type="number" min={1} value={draft.scaleMax} onChange={(event) => patch({ scaleMax: Number(event.target.value) })} />
          </Field>
        </div>

        <TrackScope label="Track scope" tracks={tracks} value={draft.trackIds} onChange={(trackIds) => patch({ trackIds })} />

        <div className="evaluation-field-row evaluation-window-row">
          <Field label="Opens" hint="Reviewers cannot open assigned proposals before this">
            <DateTimePicker value={draft.opensAt} onChange={(opensAt) => patch({ opensAt })} tz={timezone} />
          </Field>
          <Field label="Closes" hint="Saving stops at this moment; prior work stays readable">
            <DateTimePicker value={draft.closesAt} onChange={(closesAt) => patch({ closesAt })} tz={timezone} />
          </Field>
        </div>

        <div className="inline-setting">
          <div>
            <b>Blind review</b>
            <small>Hide author, co-authors and every answer not marked as proposal content in the form builder.</small>
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
          <Select value={draft.status} onChange={(event) => patch({ status: event.target.value === "closed" ? "closed" : "open" })}>
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
          {draft.criteria.map((criterion, index) => (
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
                  onChange={(event) => patch({
                    criteria: draft.criteria.map((entry, position) => position === index ? { ...entry, kind: event.target.value as CriterionKind } : entry),
                  })}
                >
                  <option value="numeric">Number on the scale</option>
                  <option value="select">Choice</option>
                  <option value="text">Written feedback</option>
                </Select>
              </Field>
              <Field label="Weight" {...(criterion.kind === "text" ? { hint: "Written feedback never enters the mean" } : {})}>
                <input
                  type="number" min={1} step={1} value={criterion.weight} disabled={criterion.kind === "text"}
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
                aria-label={`Remove ${criterion.label || "criterion"}`}
                onClick={() => patch({ criteria: draft.criteria.filter((_, position) => position !== index) })}
              >
                <Trash2 size={15} />
              </Button>
              {criterion.kind === "select" && (
                <Field label="Choices" hint="One per line as “Label:score”. Leave the score off for a choice that is recorded but never averaged.">
                  <textarea
                    value={criterion.optionsText}
                    onChange={(event) => patch({
                      criteria: draft.criteria.map((entry, position) => position === index ? { ...entry, optionsText: event.target.value } : entry),
                    })}
                    placeholder={"Strong accept:5\nAccept:4\nNot applicable"}
                  />
                </Field>
              )}
            </div>
          ))}
          <Button variant="secondary" onClick={() => patch({ criteria: [...draft.criteria, { id: null, label: "", weight: 1, kind: "numeric", required: true, optionsText: "" }] })}>
            <Plus size={15} /> Add criterion
          </Button>
        </section>
        </fieldset>

        <section>
          <h3>Reviewers</h3>
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
        </section>

        <p className="portal-note">
          Rounds are ordered plans — to run a second one, create it with a narrower scope, then sort Abstracts by rating and move the survivors.
        </p>
        <div className="drawer-actions">
          <Button variant="secondary" disabled={saving} onClick={closeEditor}>Cancel</Button>
          <Button disabled={saving || draft.name.trim() === ""} onClick={save}>
            {saving ? "Saving…" : pendingReviewerPlanId ? "Retry reviewer assignments" : plan ? "Save round" : "Create round"}
          </Button>
        </div>
      </div>
    </Drawer>
  );
}
