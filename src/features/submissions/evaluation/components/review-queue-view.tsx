"use client";

import { ClipboardCheck, Star } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { SubmissionDetailDTO } from "@/shared/contracts";
import { formatCode } from "@/features/submissions/index.client";
import { SubmissionAnswers } from "@/features/submissions/components/submission-answers";
import { Button, EmptyState, Field, PageHeader, ProgressBar, StatusBadge } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import { nextCriterionToScore, nextUnscored } from "../queue";
import { weightedOverall } from "../scoring";
import type { PlanDTO, ReviewQueueRow } from "../types";

/**
 * One reviewer, one round, one proposal at a time.
 *
 * The reviewer reads the answers through the same renderer the organizer's
 * drawer uses, scores against the round's own scale, and moves on. Everything
 * the server decides — which proposals are here at all, and what a set of
 * criterion scores adds up to — is re-decided on save; this component only
 * shows it.
 */

type Draft = { criterion: Record<string, number>; overall: number | null; comment: string };

function draftFrom(row: ReviewQueueRow | undefined): Draft {
  return {
    criterion: row?.myCriterionScores ?? {},
    overall: row?.myScore ?? null,
    comment: row?.myComment ?? "",
  };
}

/**
 * The client's preview of the round's weighted mean — the same pure function the
 * server scores with, so the number on screen cannot disagree with the number
 * that gets stored.
 */
function previewOverall(plan: PlanDTO, draft: Draft): number | null {
  return plan.criteria.length === 0 ? draft.overall : weightedOverall(plan.criteria, draft.criterion);
}

export function ReviewQueueView({
  eventId,
  plan,
  plans,
  rows,
  progress,
}: {
  eventId: string;
  plan: PlanDTO | null;
  /** Every round this reviewer can switch between, open ones first. */
  plans: PlanDTO[];
  rows: ReviewQueueRow[];
  progress: { scored: number; total: number };
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [activeId, setActiveId] = useState(rows[0]?.submissionId ?? "");
  const [detail, setDetail] = useState<SubmissionDetailDTO | null>(null);
  const [detailError, setDetailError] = useState("");
  const [draft, setDraft] = useState<Draft>(() => draftFrom(rows[0]));
  const [saving, setSaving] = useState(false);

  const active = useMemo(() => rows.find((row) => row.submissionId === activeId), [rows, activeId]);
  const scale = useMemo(
    () => plan ? Array.from({ length: plan.scaleMax - plan.scaleMin + 1 }, (_, index) => plan.scaleMin + index) : [],
    [plan],
  );

  const open = useCallback((submissionId: string) => {
    setActiveId(submissionId);
    setDraft(draftFrom(rows.find((row) => row.submissionId === submissionId)));
  }, [rows]);

  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    setDetail(null);
    setDetailError("");
    fetch(`/api/internal/submissions/${eventId}/${activeId}`)
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as { data?: SubmissionDetailDTO; error?: { message?: string } } | null;
        if (cancelled) return;
        if (!response.ok || !payload?.data) setDetailError(payload?.error?.message ?? "Could not load this proposal");
        else setDetail(payload.data);
      })
      .catch(() => { if (!cancelled) setDetailError("Could not load this proposal"); });
    // A reviewer moving quickly down the list must not have a late response for
    // one they have passed replace what they are reading now.
    return () => { cancelled = true; };
  }, [eventId, activeId]);

  const save = useCallback(async () => {
    if (!plan || !active) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/internal/evaluation/${eventId}/reviews`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          planId: plan.id,
          submissionId: active.submissionId,
          overallScore: plan.criteria.length > 0 ? null : draft.overall,
          criterionScores: plan.criteria.length > 0 ? draft.criterion : {},
          comment: draft.comment.trim() === "" ? null : draft.comment,
        }),
      });
      const payload = await response.json().catch(() => null) as { data?: { overallScore: number | null }; error?: { message?: string } } | null;
      if (!response.ok || !payload?.data) {
        toast(payload?.error?.message ?? "That score did not save");
        return;
      }
      toast(payload.data.overallScore === null
        // Saying so is the difference between "still to finish" and "lost".
        ? `${formatCode(active.code)} saved — still unscored until every criterion has a number`
        : `${formatCode(active.code)} scored ${payload.data.overallScore}`);

      const next = nextUnscored(rows, active.submissionId);
      if (next) open(next.submissionId);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }, [plan, active, eventId, draft, rows, open, router, toast]);

  // 1–5 scores and `n` advances: a reviewer working through a queue should not
  // have to reach for the mouse between proposals.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (!plan || !active) return;
      if (event.key === "n") {
        const index = rows.findIndex((row) => row.submissionId === active.submissionId);
        const next = rows[index + 1];
        if (next) open(next.submissionId);
        return;
      }
      const value = Number(event.key);
      if (!Number.isInteger(value) || !scale.includes(value)) return;
      // With criteria the keys fill the first unanswered one, so the shortcut
      // still means "this is my score" on both shapes of round.
      setDraft((current) => {
        if (plan.criteria.length === 0) return { ...current, overall: value };
        const next = nextCriterionToScore(plan.criteria, current.criterion);
        return next ? { ...current, criterion: { ...current.criterion, [next.id]: value } } : current;
      });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [plan, active, rows, scale, open]);

  if (!plan) {
    return (
      <main className="page">
        <PageHeader eyebrow="REVIEW" title="Review" />
        <EmptyState
          icon={<ClipboardCheck size={20} />}
          title="No review round is open"
          description="An organizer creates a scoring round and assigns reviewers to it before anything appears here."
        />
      </main>
    );
  }

  const preview = previewOverall(plan, draft);

  return (
    <main className="page">
      <PageHeader
        eyebrow="REVIEW"
        title={plan.name}
        description={`Scoring ${plan.scaleMin}–${plan.scaleMax}${plan.criteria.length > 0 ? ` across ${plan.criteria.length} criteria` : ""}.`}
        {...(plans.length > 1 ? {
          actions: (
            <Field label="Round">
              <select
                value={plan.id}
                onChange={(event) => router.push(`?planId=${event.target.value}`)}
                aria-label="Review round"
              >
                {plans.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}{option.status === "closed" ? " (closed)" : ""}
                  </option>
                ))}
              </select>
            </Field>
          ),
        } : {})}
      />

      <div className="evaluation-summary">
        <article>
          <div><span>Your progress</span><b>Scored {progress.scored} of {progress.total}</b></div>
          <ProgressBar value={progress.total === 0 ? 0 : Math.round((progress.scored / progress.total) * 100)} />
        </article>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck size={20} />}
          title="No abstracts routed to you yet"
          description="An organizer assigns reviewers to tracks; when yours has proposals in it, they appear here."
        />
      ) : (
        <section className="review-workspace">
          <aside className="review-queue">
            <header>
              <div>
                <h2>Your review queue</h2>
                <span>{rows.filter((row) => row.myScore === null).length} still to score</span>
              </div>
            </header>
            <div>
              {rows.map((row) => (
                <button
                  key={row.submissionId}
                  type="button"
                  className={row.submissionId === activeId ? "active" : ""}
                  onClick={() => open(row.submissionId)}
                >
                  <div>
                    <span>{formatCode(row.code)}</span>
                    {row.myScore !== null && <em><Star size={11} fill="currentColor" />{row.myScore}</em>}
                  </div>
                  <b>{row.title}</b>
                  <small>{row.trackName ?? "Uncategorized"}</small>
                </button>
              ))}
            </div>
          </aside>

          {active && (
            <article className="review-detail">
              <header>
                <div>
                  <span>{formatCode(active.code)}</span>
                  {detail && <StatusBadge value={detail.status} />}
                  <h1>{active.title}</h1>
                  <p>
                    {active.trackName ?? "Uncategorized"}
                    {active.nScores > 0 && ` · round average ${active.avgRating?.toFixed(1)} from ${active.nScores}`}
                  </p>
                </div>
              </header>

              <div className="review-detail-body">
                {detailError && <p className="portal-note" role="alert">{detailError}</p>}
                {!detail && !detailError && <p className="portal-note">Loading the proposal…</p>}
                {detail && (
                  <section className="submitted-answers">
                    <h2>What the speaker submitted</h2>
                    <SubmissionAnswers data={detail.answerPanel} />
                  </section>
                )}
              </div>

              <aside className="score-panel">
                <div className="score-heading">
                  <span className="metric-icon purple"><Star size={19} /></span>
                  <div>
                    <h2>Your score</h2>
                    <p>{plan.name} · {plan.scaleMin}–{plan.scaleMax}</p>
                  </div>
                </div>

                {plan.criteria.length === 0 ? (
                  <div className="score-buttons">
                    {scale.map((value) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={draft.overall === value}
                        className={draft.overall === value ? "active" : ""}
                        onClick={() => setDraft((current) => ({ ...current, overall: value }))}
                      >
                        <Star size={17} fill={(draft.overall ?? 0) >= value ? "currentColor" : "none"} />
                        <span>{value}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <>
                    {plan.criteria.map((criterion) => (
                      <Field key={criterion.id} label={criterion.label} {...(criterion.weight === 1 ? {} : { hint: `Weight ${criterion.weight}` })}>
                        <div className="score-buttons">
                          {scale.map((value) => (
                            <button
                              key={value}
                              type="button"
                              aria-pressed={draft.criterion[criterion.id] === value}
                              className={draft.criterion[criterion.id] === value ? "active" : ""}
                              onClick={() => setDraft((current) => ({
                                ...current,
                                criterion: { ...current.criterion, [criterion.id]: value },
                              }))}
                            >
                              <span>{value}</span>
                            </button>
                          ))}
                        </div>
                      </Field>
                    ))}
                    <p className="pinned-note">
                      {preview === null
                        ? "Overall score appears once every criterion has a number."
                        : `Overall ${preview} — the weighted mean, recomputed on the server when you save.`}
                    </p>
                  </>
                )}

                <Field label="Private notes" hint="Only organizers and reviewers can see this.">
                  <textarea
                    value={draft.comment}
                    maxLength={2000}
                    onChange={(event) => setDraft((current) => ({ ...current, comment: event.target.value }))}
                    placeholder="What stood out? Any concerns?"
                  />
                </Field>

                <Button disabled={saving || plan.status === "closed"} onClick={save}>
                  {saving ? "Saving…" : "Save & next"}
                </Button>
                {plan.status === "closed" && <small className="keyboard-hint">This round is closed, so scores can no longer change.</small>}
                <small className="keyboard-hint">Press {plan.scaleMin}–{plan.scaleMax} to score, n for the next proposal.</small>
              </aside>
            </article>
          )}
        </section>
      )}
    </main>
  );
}
