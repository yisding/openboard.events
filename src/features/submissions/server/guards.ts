import { SUBMISSION_TRANSITIONS, canTransition, type SubmissionStatus } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";

/** Every rendering of a submission code, everywhere. */
export function formatCode(code: number): string {
  return `SESS-${code}`;
}

/**
 * The seven-state lifecycle, enforced in one place. The transition table is
 * frozen in contracts and the database trigger enforces the same edges, so a
 * caller that gets past this still cannot write an illegal state.
 */
export function assertTransition(from: SubmissionStatus, to: SubmissionStatus): void {
  if (!canTransition(from, to)) {
    throw new AppError(
      "STALE_STATUS",
      `A submission cannot go from ${from} to ${to}`,
      { from, to, allowed: SUBMISSION_TRANSITIONS[from] },
    );
  }
}

/**
 * What a speaker is told. The two queue states are internal review state: a
 * speaker who learns their submission is in the accept queue knows the decision
 * before the organizer has sent it.
 */
export function toPortalStatus(status: SubmissionStatus): "draft" | "pending" | "accepted" | "declined" | "withdrawn" {
  switch (status) {
    case "accept_queue":
    case "decline_queue":
      return "pending";
    case "draft":
    case "pending":
    case "accepted":
    case "declined":
    case "withdrawn":
      return status;
  }
}
