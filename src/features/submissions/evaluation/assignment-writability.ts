import type { PlanDTO } from "./types";

export type AssignmentLockReason = "closed" | "expired";

/**
 * Reviewer work may be prepared before a round opens, but never after the
 * organizer has made it final or its save window has elapsed.
 */
export function assignmentLockReason(
  plan: Pick<PlanDTO, "status" | "closesAt">,
  now: Date = new Date(),
): AssignmentLockReason | null {
  if (plan.status !== "open") return "closed";
  if (plan.closesAt !== null && new Date(plan.closesAt).getTime() <= now.getTime()) return "expired";
  return null;
}

export function assignmentLockGuidance(reason: AssignmentLockReason): string {
  return reason === "closed"
    ? "Reopen this round before changing reviewer assignments."
    : "Extend this round’s close date before changing reviewer assignments.";
}
