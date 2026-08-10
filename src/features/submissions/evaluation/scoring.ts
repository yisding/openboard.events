import type { SubmissionStatus } from "@/shared/contracts";

/**
 * The rule that decides what a reviewer sees. It is pure and lives apart from
 * the SQL that mirrors it because it is re-checked server-side on every write —
 * the queue a client rendered is never the authority on what that client may
 * score.
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
