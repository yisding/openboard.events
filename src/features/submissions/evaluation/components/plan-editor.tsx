"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Drawer, Field } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import type { PlanDTO } from "../types";
import type { EventMember, TrackOption } from "./plans-view";

/**
 * Creating and editing a round. Rounds are ordered plans rather than a state
 * machine: Round 2 is a new plan with a narrower scope, and the organizer moves
 * survivors into it from Abstracts by rating. The drawer says so, because the
 * alternative is an organizer looking for an "advance round" button that will
 * never exist.
 */

type CriterionDraft = { id: string | null; label: string; weight: number };

type PlanDraft = {
  name: string;
  round: number;
  scaleMin: number;
  scaleMax: number;
  status: PlanDTO["status"];
  /** Empty is "every track" — the server stores that as NULL. */
  trackIds: string[];
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
  criteria: [],
  reviewers: [],
});

function draftFrom(plan: PlanDTO): PlanDraft {
  return {
    name: plan.name,
    round: plan.round,
    scaleMin: plan.scaleMin,
    scaleMax: plan.scaleMax,
    status: plan.status,
    trackIds: plan.trackIds ?? [],
    criteria: plan.criteria.map((criterion) => ({ id: criterion.id as string, label: criterion.label, weight: criterion.weight })),
    reviewers: plan.reviewers.map((reviewer) => ({ userId: reviewer.userId as string, trackIds: reviewer.trackIds ?? [] })),
  };
}

/** A `<select multiple>` of tracks, where selecting nothing means every track. */
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
      <select
        multiple
        value={value}
        size={Math.min(tracks.length, 4)}
        onChange={(event) => onChange(Array.from(event.target.selectedOptions, (option) => option.value))}
      >
        {tracks.map((track) => <option key={track.id} value={track.id}>{track.name}</option>)}
      </select>
    </Field>
  );
}

export function PlanEditor({
  eventId,
  plan,
  tracks,
  members,
  nextRound,
  onClose,
}: {
  eventId: string;
  /** Null when creating; the round being edited otherwise. */
  plan: PlanDTO | null;
  tracks: TrackOption[];
  members: EventMember[];
  nextRound: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [draft, setDraft] = useState<PlanDraft>(plan ? draftFrom(plan) : emptyDraft(nextRound));
  const [saving, setSaving] = useState(false);

  const patch = (next: Partial<PlanDraft>) => setDraft((current) => ({ ...current, ...next }));

  async function save() {
    setSaving(true);
    try {
      const body = {
        name: draft.name,
        round: draft.round,
        scaleMin: draft.scaleMin,
        scaleMax: draft.scaleMax,
        status: draft.status,
        // Empty means every track, which the server stores as NULL.
        trackIds: draft.trackIds.length === 0 ? null : draft.trackIds,
        criteria: draft.criteria.map((criterion) => ({ id: criterion.id, label: criterion.label, weight: criterion.weight })),
        // Optimistic concurrency, so a second organizer's edit is a conflict
        // the first one sees rather than an overwrite they never learn about.
        ...(plan ? { expectedUpdatedAt: plan.updatedAt } : {}),
      };
      const response = await fetch(
        plan ? `/api/internal/evaluation/${eventId}/plans/${plan.id}` : `/api/internal/evaluation/${eventId}/plans`,
        { method: plan ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
      );
      const payload = await response.json().catch(() => null) as { data?: { planId: string }; error?: { message?: string } } | null;
      if (!response.ok || !payload?.data) {
        toast(payload?.error?.message ?? "That round did not save");
        return;
      }

      // Reviewers are a separate full-set replace, so a failure here leaves the
      // round saved and says which half went wrong.
      const assign = await fetch(`/api/internal/evaluation/${eventId}/plans/${payload.data.planId}/reviewers`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reviewers: draft.reviewers.map((reviewer) => ({
            userId: reviewer.userId,
            trackIds: reviewer.trackIds.length === 0 ? null : reviewer.trackIds,
          })),
        }),
      });
      if (!assign.ok) {
        const failure = await assign.json().catch(() => null) as { error?: { message?: string } } | null;
        toast(failure?.error?.message ?? "The round saved, but its reviewers did not");
      } else {
        toast(plan ? `${draft.name} updated` : `${draft.name} created`);
      }
      onClose();
      router.refresh();
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
    <Drawer open onClose={onClose} title={plan ? `Edit ${plan.name}` : "New evaluation plan"}>
      <div className="form-stack">
        <Field label="Round name" required>
          <input autoFocus value={draft.name} onChange={(event) => patch({ name: event.target.value })} placeholder="e.g. Round 1 · Program committee" />
        </Field>

        <div className="field-row">
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

        <Field label="Status">
          <select value={draft.status} onChange={(event) => patch({ status: event.target.value === "closed" ? "closed" : "open" })}>
            <option value="open">Open — reviewers can score</option>
            <option value="closed">Closed — scores are final</option>
          </select>
        </Field>

        <section>
          <h3>Criteria</h3>
          <p className="portal-note">
            With no criteria a reviewer gives one score. With criteria they score each, and the overall is the weighted mean.
          </p>
          {draft.criteria.map((criterion, index) => (
            <div className="field-row" key={criterion.id ?? `new-${index}`}>
              <Field label="Label">
                <input
                  value={criterion.label}
                  onChange={(event) => patch({
                    criteria: draft.criteria.map((entry, position) => position === index ? { ...entry, label: event.target.value } : entry),
                  })}
                />
              </Field>
              <Field label="Weight">
                <input
                  type="number" min={1} step={1} value={criterion.weight}
                  onChange={(event) => patch({
                    criteria: draft.criteria.map((entry, position) => position === index ? { ...entry, weight: Number(event.target.value) } : entry),
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
            </div>
          ))}
          <Button variant="secondary" onClick={() => patch({ criteria: [...draft.criteria, { id: null, label: "", weight: 1 }] })}>
            <Plus size={15} /> Add criterion
          </Button>
        </section>

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
      </div>

      <div className="drawer-actions">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button disabled={saving || draft.name.trim() === ""} onClick={save}>
          {saving ? "Saving…" : plan ? "Save round" : "Create round"}
        </Button>
      </div>
    </Drawer>
  );
}
