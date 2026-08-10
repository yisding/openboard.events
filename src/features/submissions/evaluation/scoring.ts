import type {
  CriterionSpec,
  CriterionValue,
  CriterionValues,
  PlanStatus,
  ReviewWindow,
  SubmissionStatus,
} from "@/shared/contracts";

/**
 * The two rules that decide what a reviewer sees and what their score is worth.
 * They are pure and live apart from the SQL that mirrors them because both are
 * re-checked server-side on every write — the queue a client rendered is never
 * the authority on what that client may score.
 */

/** A submission nobody may score, whatever their assignment says. */
const UNSCORABLE: readonly SubmissionStatus[] = ["draft", "withdrawn"];

export function isScorableStatus(status: SubmissionStatus): boolean {
  return !UNSCORABLE.includes(status);
}

/**
 * The effective scope rule, stated once: a reviewer sees submission `s` in plan
 * `p` iff `s` is scorable **and** the plan's track scope admits it **and** their
 * own assignment's scope admits it. `null` on either side means "all tracks",
 * so an uncategorized submission (`trackId === null`) is visible only when both
 * scopes are open — a track filter cannot match a submission that has no track.
 */
export function inReviewerScope(input: {
  status: SubmissionStatus;
  submissionTrackId: string | null;
  planTrackIds: readonly string[] | null;
  assignmentTrackIds: readonly string[] | null;
}): boolean {
  if (!isScorableStatus(input.status)) return false;
  const admits = (scope: readonly string[] | null) =>
    scope === null || (input.submissionTrackId !== null && scope.includes(input.submissionTrackId));
  return admits(input.planTrackIds) && admits(input.assignmentTrackIds);
}

export type CriterionWeight = { id: string; weight: number };

/**
 * The overall score a round with criteria derives, rounded to two decimals.
 * A criterion left blank makes the review "in progress": it returns `null`, the
 * row still saves with its comment, and `submission_ratings_v` leaves it out of
 * the average rather than counting it as a zero.
 */
export function weightedOverall(
  criteria: readonly CriterionWeight[],
  scores: Record<string, number>,
): number | null {
  if (criteria.length === 0) return null;
  let weighted = 0;
  let totalWeight = 0;
  for (const criterion of criteria) {
    const score = scores[criterion.id];
    if (typeof score !== "number" || Number.isNaN(score)) return null;
    weighted += score * criterion.weight;
    totalWeight += criterion.weight;
  }
  if (totalWeight <= 0) return null;
  return Math.round((weighted / totalWeight) * 100) / 100;
}

/**
 * M50 — the typed scorecard's arithmetic and completion rule.
 *
 * These three functions are the whole contract between "what a reviewer typed"
 * and "what `submission_ratings_v` averages", and they are pure so the server,
 * the queue UI's live preview and the tests all reach the same number. The
 * server is still the only writer: the client may preview `weightedMean`, but
 * the value stored is the one recomputed here on save.
 */

/**
 * M19 stored a bare number per criterion. Reading is where that payload is
 * lifted to the discriminated shape, so no consumer has to know which era a row
 * was written in. Anything unrecognisable is dropped rather than guessed at —
 * an unreadable answer must not become a score.
 */
export function normalizeCriterionValues(raw: unknown): CriterionValues {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const values: Record<string, CriterionValue> = {};
  for (const [criterionId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      values[criterionId] = { kind: "numeric", value };
      continue;
    }
    if (value === null || typeof value !== "object") continue;
    const entry = value as { kind?: unknown; value?: unknown; optionId?: unknown };
    if (entry.kind === "numeric" && typeof entry.value === "number" && Number.isFinite(entry.value)) {
      values[criterionId] = { kind: "numeric", value: entry.value };
    } else if (entry.kind === "select" && typeof entry.optionId === "string" && entry.optionId.length > 0) {
      values[criterionId] = { kind: "select", optionId: entry.optionId };
    } else if (entry.kind === "text" && typeof entry.value === "string") {
      values[criterionId] = { kind: "text", value: entry.value };
    }
  }
  return values as CriterionValues;
}

/**
 * What one answer is worth, or `null` for "present but not arithmetic".
 * A text note and an unscored select option are both real answers that simply
 * never move the mean — returning 0 for them would silently punish a proposal
 * for a question that was never about a number.
 */
export function scorableValue(spec: CriterionSpec, value: CriterionValue | undefined): number | null {
  if (!value) return null;
  if (spec.kind === "numeric" && value.kind === "numeric") return Number.isFinite(value.value) ? value.value : null;
  if (spec.kind === "select" && value.kind === "select") {
    const option = spec.options.find((candidate) => candidate.id === value.optionId);
    return option && option.score !== null ? option.score : null;
  }
  return null;
}

/** Whether an answer is one this criterion can accept at all (kind and bounds). */
export function isValidCriterionValue(
  spec: CriterionSpec,
  value: CriterionValue | undefined,
  scale: { min: number; max: number },
): boolean {
  if (!value || value.kind !== spec.kind) return false;
  if (value.kind === "text") return value.value.trim().length > 0;
  if (value.kind === "select") return spec.options.some((option) => option.id === value.optionId);
  const min = spec.minValue ?? scale.min;
  const max = spec.maxValue ?? scale.max;
  return Number.isFinite(value.value) && value.value >= min && value.value <= max;
}

/**
 * The round's weighted mean over the values that are actually scorable, rounded
 * to two decimals. Weights are taken only from the criteria that contributed,
 * so an optional text criterion sitting next to two numbers does not dilute
 * them; with nothing scorable at all the answer is `null`, never 0.
 */
export function weightedMean(specs: readonly CriterionSpec[], values: CriterionValues): number | null {
  let weighted = 0;
  let totalWeight = 0;
  for (const spec of specs) {
    const score = scorableValue(spec, values[spec.id]);
    if (score === null) continue;
    weighted += score * spec.weight;
    totalWeight += spec.weight;
  }
  if (totalWeight <= 0) return null;
  return Math.round((weighted / totalWeight) * 100) / 100;
}

/**
 * When a review counts as finished — and therefore when `submitted_at` is
 * stamped and the reviewer stops appearing in "still outstanding".
 *
 * Every `required` criterion must hold a valid value. A round with no criteria
 * at all falls back to M19's single overall score, so an existing round keeps
 * behaving exactly as it did.
 */
export function isReviewComplete(
  specs: readonly CriterionSpec[],
  values: CriterionValues,
  legacyOverall: number | null,
  scale: { min: number; max: number },
): boolean {
  if (specs.length === 0) return legacyOverall !== null;
  return specs.every((spec) => !spec.required || isValidCriterionValue(spec, values[spec.id], scale));
}

/**
 * The reviewer's window into a round, derived once and re-derived on every
 * write. The window is half-open — `opens_at <= now < closes_at` — so a round
 * that closes at 17:00 accepts a save at 16:59:59 and refuses one at 17:00:00,
 * with no ambiguous second in between.
 *
 * After close, and for a plan an organizer has marked `closed`, the reviewer
 * keeps read access: their own prior work does not disappear because a deadline
 * passed. Before open, they get neither.
 */
export function reviewWindow(
  plan: { status: PlanStatus; opensAt: string | null; closesAt: string | null },
  now: Date = new Date(),
): ReviewWindow {
  const at = now.getTime();
  const opensAt = plan.opensAt === null ? null : new Date(plan.opensAt).getTime();
  const closesAt = plan.closesAt === null ? null : new Date(plan.closesAt).getTime();
  const beforeOpen = opensAt !== null && at < opensAt;
  const afterClose = closesAt !== null && at >= closesAt;
  const state = beforeOpen ? "before_open" : afterClose ? "closed" : "open";
  return {
    opensAt: plan.opensAt,
    closesAt: plan.closesAt,
    state,
    canRead: !beforeOpen,
    canSave: state === "open" && plan.status === "open",
  };
}
