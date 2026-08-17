"use client";

import { ClipboardCheck, Lock, ShieldOff, Star } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LIMITS } from "@/shared/contracts";
import type { CriterionSpec, CriterionValue, CriterionValues, ReviewWindow, SubmissionDetailDTO } from "@/shared/contracts";
import { formatCode } from "@/features/submissions/index.client";
import { SubmissionAnswers } from "@/features/submissions/components/submission-answers";
import { ConfirmDialog } from "@/shared/ui/app/confirm-dialog";
import { FlowNavControls } from "@/shared/ui/app/flow-nav-controls";
import { SkeletonText } from "@/shared/ui/app/skeleton";
import { formatTzTime } from "@/shared/ui/app/tz-time";
import { useGuardedAction, useUnsavedWorkGuard } from "@/shared/ui/app/unsaved-work-guard";
import { Button, EmptyState, Field, PageHeader, ProgressBar, Select, StatusBadge } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import { nextUnscored } from "../queue";
import { isReviewComplete, weightedMean } from "../scoring";
import type { PlanDTO, ReviewQueueRow } from "../types";

/**
 * One reviewer, one round, one proposal at a time.
 *
 * The reviewer reads the answers through the same renderer the organizer's
 * drawer uses, answers the round's own scorecard, and moves on. Everything the
 * server decides — which proposals are here at all, whether the window is open,
 * and what a set of answers adds up to — is re-decided on save; this component
 * only shows it, so a disabled button here is a courtesy, never the control.
 */

type Draft = { values: CriterionValues; overall: number | null; comment: string };

export function isReviewDraftDirty(draft: Draft, saved: Draft) {
  if (draft.overall !== saved.overall || draft.comment !== saved.comment) return true;
  const canonicalValues = (values: CriterionValues) => Object.entries(values)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, value]) => [id, value]);
  return JSON.stringify(canonicalValues(draft.values)) !== JSON.stringify(canonicalValues(saved.values));
}

function draftFrom(row: ReviewQueueRow | undefined): Draft {
  return {
    values: row?.myCriterionValues ?? {},
    overall: row?.myScore ?? null,
    comment: row?.myComment ?? "",
  };
}

/** The plan's criteria as the pure grader sees them — the same shape the server grades with. */
function specsOf(plan: PlanDTO): CriterionSpec[] {
  return plan.criteria.map((criterion) => ({
    id: criterion.id,
    kind: criterion.kind,
    weight: criterion.weight,
    required: criterion.required,
    options: criterion.options,
    minValue: criterion.minValue,
    maxValue: criterion.maxValue,
  }));
}

/**
 * The client's preview of the round's weighted mean — the same pure function the
 * server scores with, so the number on screen cannot disagree with the number
 * that gets stored.
 */
function previewOverall(plan: PlanDTO, specs: CriterionSpec[], draft: Draft): number | null {
  return plan.criteria.length === 0 ? draft.overall : weightedMean(specs, draft.values);
}

/**
 * The window banner, in the *event's* zone.
 *
 * `toLocaleString()` is not an option here even though this reads like display
 * trivia. This is a client component that Next server-renders first: on the
 * Worker that call formats in UTC, in the browser it formats in the viewer's
 * zone, the two strings differ and React tears the tree down with #418
 * ("hydration failed … server rendered text didn't match"). It also renders the
 * wrong hour to anyone outside the event's zone, which is the reason `TzTime`
 * exists at all — `formatTzTime` is the same formatter, for the strings that
 * cannot be an element.
 */
function windowNotice(window: ReviewWindow | null, plan: PlanDTO, timezone: string): string | null {
  if (!window) return null;
  const at = (instant: string) => formatTzTime(instant, timezone, "dateTime");
  if (window.state === "before_open") {
    return `This round opens ${window.opensAt ? at(window.opensAt) : "later"}. Nothing is readable until then.`;
  }
  if (window.state === "closed" || !window.canSave) {
    return plan.status === "closed"
      ? "This round is closed. Your reviews stay readable, but scores can no longer change."
      : `This round closed ${window.closesAt ? at(window.closesAt) : ""}. Your reviews stay readable, but scores can no longer change.`;
  }
  return window.closesAt ? `Open until ${at(window.closesAt)}.` : null;
}

export function ReviewQueueView({
  eventId,
  timezone,
  plan,
  plans,
  rows,
  progress,
  window: reviewWindow,
}: {
  eventId: string;
  /** The event's zone — every rendered time in the product uses it, not the viewer's. */
  timezone: string;
  plan: PlanDTO | null;
  /** Every round this reviewer can switch between, open ones first. */
  plans: PlanDTO[];
  rows: ReviewQueueRow[];
  progress: { scored: number; total: number };
  window: ReviewWindow | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const { allowNextNavigation } = useGuardedAction();
  const [activeId, setActiveId] = useState(rows[0]?.submissionId ?? "");
  const [detail, setDetail] = useState<SubmissionDetailDTO | null>(null);
  const [detailError, setDetailError] = useState("");
  const [draft, setDraft] = useState<Draft>(() => draftFrom(rows[0]));
  const [savedDraft, setSavedDraft] = useState<Draft>(() => draftFrom(rows[0]));
  const [saving, setSaving] = useState(false);
  const [recusing, setRecusing] = useState(false);
  const [recusalReason, setRecusalReason] = useState("");
  const [pendingNavigation, setPendingNavigation] = useState<
    { kind: "submission"; id: string } | { kind: "round"; id: string } | null
  >(null);

  const active = useMemo(() => rows.find((row) => row.submissionId === activeId), [rows, activeId]);
  const activeIndex = rows.findIndex((row) => row.submissionId === activeId);
  const specs = useMemo(() => plan ? specsOf(plan) : [], [plan]);
  const scale = useMemo(
    () => plan ? Array.from({ length: plan.scaleMax - plan.scaleMin + 1 }, (_, index) => plan.scaleMin + index) : [],
    [plan],
  );
  const canSave = reviewWindow?.canSave ?? false;

  const openNow = useCallback((submissionId: string) => {
    const nextDraft = draftFrom(rows.find((row) => row.submissionId === submissionId));
    setActiveId(submissionId);
    setDraft(nextDraft);
    setSavedDraft(nextDraft);
    setRecusing(false);
    setRecusalReason("");
  }, [rows]);

  const draftDirty = isReviewDraftDirty(draft, savedDraft);
  const hasUnsavedWork = draftDirty || recusalReason.trim() !== "";
  useUnsavedWorkGuard(hasUnsavedWork);

  const requestOpen = useCallback((submissionId: string) => {
    if (saving || submissionId === activeId) return;
    if (hasUnsavedWork) {
      setPendingNavigation({ kind: "submission", id: submissionId });
      return;
    }
    openNow(submissionId);
  }, [saving, activeId, hasUnsavedWork, openNow]);

  const requestRound = useCallback((planId: string) => {
    if (saving || planId === plan?.id) return;
    if (hasUnsavedWork) {
      setPendingNavigation({ kind: "round", id: planId });
      return;
    }
    router.push(`?planId=${planId}`);
  }, [saving, plan?.id, hasUnsavedWork, router]);

  const discardAndNavigate = useCallback(() => {
    if (!pendingNavigation) return;
    const destination = pendingNavigation;
    setPendingNavigation(null);
    if (destination.kind === "submission") openNow(destination.id);
    else {
      const href = `?planId=${destination.id}`;
      allowNextNavigation(() => router.push(href), { destination: href });
    }
  }, [pendingNavigation, openNow, router, allowNextNavigation]);

  const setValue = useCallback((criterionId: string, value: CriterionValue | undefined) => {
    setDraft((current) => {
      const values = { ...current.values } as Record<string, CriterionValue>;
      if (value === undefined) delete values[criterionId];
      else values[criterionId] = value;
      return { ...current, values: values as CriterionValues };
    });
  }, []);

  useEffect(() => {
    if (!activeId || !plan) return;
    let cancelled = false;
    setDetail(null);
    setDetailError("");
    fetch(`/api/internal/submissions/${eventId}/${activeId}?planId=${plan.id}`)
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as { data?: SubmissionDetailDTO; error?: { message?: string } } | null;
        if (cancelled) return;
        if (!response.ok || !payload?.data) setDetailError(payload?.error?.message ?? "Could not load this submission");
        else setDetail(payload.data);
      })
      .catch(() => { if (!cancelled) setDetailError("Could not load this submission"); });
    // A reviewer moving quickly down the list must not have a late response for
    // one they have passed replace what they are reading now.
    return () => { cancelled = true; };
  }, [eventId, activeId, plan]);

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
          criterionScores: plan.criteria.length > 0 ? draft.values : {},
          comment: draft.comment.trim() === "" ? null : draft.comment,
        }),
      });
      const payload = await response.json().catch(() => null) as { data?: { overallScore: number | null; complete: boolean }; error?: { message?: string } } | null;
      if (!response.ok || !payload?.data) {
        toast(payload?.error?.message ?? "That score did not save", { kind: "error" });
        return;
      }
      toast(!payload.data.complete
        // Saying so is the difference between "still to finish" and "lost".
        ? `${formatCode(active.code)} saved — still unfinished until every required answer is in`
        : payload.data.overallScore === null
          ? `${formatCode(active.code)} submitted — this round’s answers do not produce a score`
          : `${formatCode(active.code)} scored ${payload.data.overallScore}`);

      setSavedDraft(draft);
      const next = nextUnscored(rows, active.submissionId);
      if (next) openNow(next.submissionId);
      router.refresh();
    } catch {
      toast("Could not reach the server. Your review was not saved.", { kind: "error" });
    } finally {
      setSaving(false);
    }
  }, [plan, active, eventId, draft, rows, openNow, router, toast]);

  const recuse = useCallback(async () => {
    if (!plan || !active || recusalReason.trim() === "") return;
    setSaving(true);
    try {
      const response = await fetch(`/api/internal/evaluation/${eventId}/plans/${plan.id}/recusals`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ submissionId: active.submissionId, reason: recusalReason }),
      });
      const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      if (!response.ok) {
        toast(payload?.error?.message ?? "That recusal did not save", { kind: "error" });
        return;
      }
      toast(`${formatCode(active.code)} recused — it has left your queue and the reason is on the record`);
      setRecusing(false);
      setRecusalReason("");
      router.refresh();
    } catch {
      toast("Could not reach the server. Your recusal was not saved.", { kind: "error" });
    } finally {
      setSaving(false);
    }
  }, [plan, active, eventId, recusalReason, router, toast]);

  // 1–5 scores and `n` advances: a reviewer working through a queue should not
  // have to reach for the mouse between submissions.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (!plan || !active) return;
      if (event.key === "n") {
        const next = rows[activeIndex + 1];
        if (next) requestOpen(next.submissionId);
        return;
      }
      const value = Number(event.key);
      if (!Number.isInteger(value) || !scale.includes(value)) return;
      // With criteria the keys fill the first unanswered *numeric* one, so the
      // shortcut still means "this is my score" on both shapes of round and
      // never guesses at a choice or a written answer.
      setDraft((current) => {
        if (plan.criteria.length === 0) return { ...current, overall: value };
        const numeric = plan.criteria.filter((criterion) => criterion.kind === "numeric");
        const next = numeric.find((criterion) => current.values[criterion.id]?.kind !== "numeric") ?? numeric[0];
        return next
          ? { ...current, values: { ...current.values, [next.id]: { kind: "numeric", value } } as CriterionValues }
          : current;
      });
    }
    globalThis.addEventListener("keydown", onKey);
    return () => globalThis.removeEventListener("keydown", onKey);
  }, [plan, active, activeIndex, rows, scale, requestOpen]);

  if (!plan) {
    return (
      <div className="page">
        <PageHeader eyebrow="REVIEW" title="Review" />
        <EmptyState
          icon={<ClipboardCheck size={20} />}
          title="No review round is open"
          description="An organizer creates a scoring round and assigns you submissions before anything appears here."
        />
      </div>
    );
  }

  const notice = windowNotice(reviewWindow, plan, timezone);
  const preview = previewOverall(plan, specs, draft);
  const complete = isReviewComplete(specs, draft.values, plan.criteria.length > 0 ? preview : draft.overall, { min: plan.scaleMin, max: plan.scaleMax });

  const roundSwitcher = plans.length > 1 ? {
    actions: (
      <Field label="Round">
        <Select
          value={plan.id}
          disabled={saving}
          onChange={(event) => requestRound(event.target.value)}
          aria-label="Review round"
        >
          {plans.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}{option.status === "closed" ? " (closed)" : ""}
            </option>
          ))}
        </Select>
      </Field>
    ),
  } : {};

  if (reviewWindow?.state === "before_open") {
    return (
      <div className="page">
        <PageHeader eyebrow="REVIEW" title={plan.name} {...roundSwitcher} />
        <EmptyState
          icon={<Lock size={20} />}
          title="This round has not opened yet"
          description={notice ?? "Your assignments become readable when the round opens."}
        />
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="REVIEW"
        title={plan.name}
        description={`Scoring ${plan.scaleMin}–${plan.scaleMax}${plan.criteria.length > 0 ? ` across ${plan.criteria.length} criteria` : ""}.${plan.anonymizeAuthors ? " Authors are hidden in this round." : ""}${plan.showPeerScores ? " Committee averages are shared." : " Scores stay independent while reviewers work."}`}
        {...roundSwitcher}
      />

      {notice && <p className="portal-note" role="status">{notice}</p>}

      <div className="evaluation-summary review-summary">
        <article className="review-progress-card">
          <div className="review-progress-copy"><span>Your progress</span><b>Finished {progress.scored} of {progress.total}</b></div>
          <ProgressBar label="Your review progress" value={progress.total === 0 ? 0 : Math.round((progress.scored / progress.total) * 100)} />
        </article>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck size={20} />}
          title="Nothing is assigned to you yet"
          description="An organizer assigns submissions to reviewers; when yours arrive, they appear here."
        />
      ) : (
        <section className="review-workspace">
          <aside className="review-queue">
            <header>
              <div>
                <h2>Your review queue</h2>
                <span>{rows.filter((row) => row.scoredAt === null).length} still to finish</span>
              </div>
            </header>
            <div>
              {rows.map((row) => (
                <button
                  key={row.submissionId}
                  type="button"
                  className={row.submissionId === activeId ? "active" : ""}
                  disabled={saving}
                  onClick={() => requestOpen(row.submissionId)}
                >
                  <div>
                    <span>{formatCode(row.code)}</span>
                    {row.scoredAt !== null && <em><Star size={11} fill="currentColor" />{row.myScore ?? "done"}</em>}
                  </div>
                  <b>{row.title}</b>
                  <small>{plan.anonymizeAuthors ? "Author hidden" : row.trackName ?? "Uncategorized"}</small>
                </button>
              ))}
            </div>
          </aside>

          {active && (
            <article className="review-detail">
              <header>
                <div>
                  <span className="review-detail-code">{formatCode(active.code)}</span>
                  {detail && <StatusBadge value={detail.status} />}
                  <h1>{active.title}</h1>
                  <p>
                    {plan.anonymizeAuthors ? "Blind review" : active.trackName ?? "Uncategorized"}
                    {plan.showPeerScores && active.avgRating !== null && active.nScores !== null && active.nScores > 0
                      && ` · round average ${active.avgRating.toFixed(1)} from ${active.nScores}`}
                  </p>
                </div>
                <FlowNavControls
                  index={activeIndex}
                  total={rows.length}
                  itemLabel={active.title}
                  onPrev={activeIndex > 0 ? () => requestOpen(rows[activeIndex - 1]?.submissionId ?? active.submissionId) : undefined}
                  onNext={activeIndex >= 0 && activeIndex < rows.length - 1 ? () => requestOpen(rows[activeIndex + 1]?.submissionId ?? active.submissionId) : undefined}
                />
              </header>

              <div className="review-detail-body">
                {detailError && <p className="portal-note" role="alert">{detailError}</p>}
                {!detail && !detailError && <SkeletonText lines={5} label="Loading the submission…" />}
                {detail && (
                  <section className="submitted-answers">
                    <h2>What the speaker submitted</h2>
                    <SubmissionAnswers data={detail.answerPanel} />
                  </section>
                )}
              </div>

              <aside className="score-panel">
                <div className="score-heading">
                  <span className="metric-icon accent"><Star size={19} /></span>
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
                    {plan.criteria.map((criterion) => {
                      const value = draft.values[criterion.id];
                      // Every criterion states its arithmetic, including the
                      // ones weighted 1. Suppressing the default made an
                      // unequally weighted round read as "one criterion counts,
                      // the other does not" — and the weighted mean is the
                      // number the committee decides on.
                      const hint = [
                        criterion.kind === "text" ? "Not scored" : `Weight ${criterion.weight}`,
                        criterion.required ? "Required" : "Optional",
                      ].join(" · ");
                      return (
                        <Field
                          key={criterion.id}
                          label={criterion.label}
                          hint={hint}
                          // A numeric criterion's control is a row of score
                          // buttons; a `<label>` around them names the first
                          // button after all the others, so no score can be
                          // picked by its own number. `select`/`text` are real
                          // labelable inputs and keep the label.
                          {...(criterion.kind === "numeric" ? { group: true } : {})}
                        >
                          {criterion.kind === "numeric" && (
                            <div className="score-buttons">
                              {Array.from(
                                { length: (criterion.maxValue ?? plan.scaleMax) - (criterion.minValue ?? plan.scaleMin) + 1 },
                                (_, index) => (criterion.minValue ?? plan.scaleMin) + index,
                              ).map((option) => (
                                <button
                                  key={option}
                                  type="button"
                                  aria-pressed={value?.kind === "numeric" && value.value === option}
                                  className={value?.kind === "numeric" && value.value === option ? "active" : ""}
                                  onClick={() => setValue(criterion.id, { kind: "numeric", value: option })}
                                >
                                  <span>{option}</span>
                                </button>
                              ))}
                            </div>
                          )}
                          {criterion.kind === "select" && (
                            <Select
                              value={value?.kind === "select" ? value.optionId : ""}
                              onChange={(event) => setValue(criterion.id, event.target.value === "" ? undefined : { kind: "select", optionId: event.target.value })}
                            >
                              <option value="">No answer yet</option>
                              {criterion.options.map((option) => (
                                <option key={option.id} value={option.id}>
                                  {option.label}{option.score === null ? " (not scored)" : ` (${option.score})`}
                                </option>
                              ))}
                            </Select>
                          )}
                          {criterion.kind === "text" && (
                            <textarea
                              value={value?.kind === "text" ? value.value : ""}
                              maxLength={LIMITS.REVIEW_TEXT}
                              onChange={(event) => setValue(criterion.id, event.target.value === "" ? undefined : { kind: "text", value: event.target.value })}
                              placeholder="Your written answer"
                            />
                          )}
                        </Field>
                      );
                    })}
                    <p className="pinned-note">
                      {!complete
                        ? "This review stays unfinished until every required criterion is answered."
                        : preview === null
                          ? "Finished — this round’s answers do not produce a numeric score."
                          : `Overall ${preview} — the weighted mean, recomputed on the server when you save.`}
                    </p>
                  </>
                )}

                <Field label="Private notes" hint="Only organizers and reviewers can see this.">
                  <textarea
                    value={draft.comment}
                    maxLength={LIMITS.REVIEW_TEXT}
                    onChange={(event) => setDraft((current) => ({ ...current, comment: event.target.value }))}
                    placeholder="What stood out? Any concerns?"
                  />
                </Field>

                <Button disabled={saving || !canSave} onClick={save}>
                  {saving ? "Saving…" : "Save & next"}
                </Button>
                {!canSave && <small className="keyboard-hint">{notice}</small>}

                {recusing ? (
                  <Field label="Why are you recusing yourself?" hint="Recorded with your name and the time, and visible to organizers.">
                    <textarea
                      value={recusalReason}
                      maxLength={500}
                      autoFocus
                      onChange={(event) => setRecusalReason(event.target.value)}
                      placeholder="e.g. I work with one of the authors"
                    />
                    <span className="row-actions">
                      <Button size="sm" disabled={saving || recusalReason.trim() === ""} onClick={recuse}>Confirm recusal</Button>
                      <Button size="sm" variant="ghost" onClick={() => { setRecusing(false); setRecusalReason(""); }}>Cancel</Button>
                    </span>
                  </Field>
                ) : (
                  <Button variant="ghost" size="sm" disabled={saving || !canSave} onClick={() => setRecusing(true)}>
                    <ShieldOff size={15} /> Recuse myself
                  </Button>
                )}

                <small className="keyboard-hint">Press {plan.scaleMin}–{plan.scaleMax} to score, n for the next submission.</small>
              </aside>
            </article>
          )}
        </section>
      )}
      <ConfirmDialog
        open={pendingNavigation !== null}
        title="Discard this unsaved review?"
        body="Your unsaved score, notes, or recusal reason will be lost if you leave this submission."
        confirmLabel="Discard and continue"
        onConfirm={discardAndNavigate}
        onCancel={() => setPendingNavigation(null)}
      />
    </div>
  );
}
