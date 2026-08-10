"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatCode } from "@/features/submissions/index.client";
import { Button, Drawer, Field } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import type { AssignableSubmission, PlanDTO } from "../types";

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
  const [submissions, setSubmissions] = useState<AssignableSubmission[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [reviewerIds, setReviewerIds] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [trackFilter, setTrackFilter] = useState("");
  const [mode, setMode] = useState<"add" | "replace">("add");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/internal/evaluation/${eventId}/plans/${plan.id}/assignments`)
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as { data?: { submissions: AssignableSubmission[] }; error?: { message?: string } } | null;
        if (cancelled) return;
        if (!response.ok || !payload?.data) setLoadError(payload?.error?.message ?? "Could not load this round's submissions");
        else setSubmissions(payload.data.submissions);
      })
      .catch(() => { if (!cancelled) setLoadError("Could not load this round's submissions"); });
    return () => { cancelled = true; };
  }, [eventId, plan.id]);

  const tracks = useMemo(() => {
    const seen = new Map<string, string>();
    for (const submission of submissions ?? []) {
      if (submission.trackId) seen.set(submission.trackId, submission.trackName ?? "Track");
    }
    return [...seen.entries()];
  }, [submissions]);

  const visible = useMemo(
    () => (submissions ?? []).filter((submission) => trackFilter === "" || submission.trackId === trackFilter),
    [submissions, trackFilter],
  );

  const toggle = useCallback((list: string[], id: string) => (
    list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id]
  ), []);

  async function assign() {
    setBusy(true);
    try {
      const response = await fetch(`/api/internal/evaluation/${eventId}/plans/${plan.id}/assignments`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reviewerUserIds: reviewerIds, submissionIds: selected, mode }),
      });
      const payload = await response.json().catch(() => null) as { data?: { assigned: number; removed: number }; error?: { message?: string } } | null;
      if (!response.ok || !payload?.data) {
        toast(payload?.error?.message ?? "Those assignments did not save");
        return;
      }
      toast(`${payload.data.assigned} assigned${payload.data.removed > 0 ? `, ${payload.data.removed} taken back` : ""}`);
      onClose();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer open onClose={onClose} title={`Assign work · ${plan.name}`}>
      <div className="form-stack">
        {plan.reviewers.length === 0
          ? <p className="portal-note">Add reviewers to this round before assigning work to them.</p>
          : (
            <section>
              <h3>Reviewers</h3>
              {plan.reviewers.map((reviewer) => (
                <label key={reviewer.userId} className="reviewer-assignment">
                  <input
                    type="checkbox"
                    checked={reviewerIds.includes(reviewer.userId)}
                    onChange={() => setReviewerIds((current) => toggle(current, reviewer.userId))}
                  />
                  <b>{reviewer.name || reviewer.email}</b>{" "}
                  <small>{reviewer.completed}/{reviewer.assigned} done{reviewer.recused > 0 ? ` · ${reviewer.recused} recused` : ""}</small>
                </label>
              ))}
            </section>
          )}

        <Field label="Filter by track" hint="Narrows the list below; it does not change what gets assigned.">
          <select value={trackFilter} onChange={(event) => setTrackFilter(event.target.value)}>
            <option value="">Every track in this round</option>
            {tracks.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </Field>

        <section>
          <h3>Submissions</h3>
          {loadError && <p className="portal-note" role="alert">{loadError}</p>}
          {!submissions && !loadError && <p className="portal-note">Loading this round&apos;s submissions…</p>}
          {submissions && visible.length === 0 && <p className="portal-note">No submissions match this filter.</p>}
          <span className="row-actions">
            <Button size="sm" variant="secondary" onClick={() => setSelected(visible.map((submission) => submission.submissionId))}>
              Select all shown
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected([])}>Clear</Button>
          </span>
          {visible.map((submission) => (
            <label key={submission.submissionId} className="reviewer-assignment">
              <input
                type="checkbox"
                checked={selected.includes(submission.submissionId)}
                onChange={() => setSelected((current) => toggle(current, submission.submissionId))}
              />
              <b>{formatCode(submission.code)} {submission.title}</b>{" "}
              <small>{submission.trackName ?? "Uncategorized"} · {submission.assignedTo.length} assigned</small>
            </label>
          ))}
        </section>

        <Field label="Mode">
          <select value={mode} onChange={(event) => setMode(event.target.value === "replace" ? "replace" : "add")}>
            <option value="add">Add to the selected reviewers&apos; queues</option>
            <option value="replace">Replace their queues with exactly this selection</option>
          </select>
        </Field>
        <p className="portal-note">
          Recusals are never undone by either mode — a reviewer who declared a conflict stays off that submission.
        </p>
      </div>

      <div className="drawer-actions">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button disabled={busy || reviewerIds.length === 0 || (mode === "add" && selected.length === 0)} onClick={assign}>
          {busy ? "Assigning…" : "Assign"}
        </Button>
      </div>
    </Drawer>
  );
}
