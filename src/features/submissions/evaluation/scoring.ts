import type { SubmissionStatus } from "@/shared/contracts";

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
