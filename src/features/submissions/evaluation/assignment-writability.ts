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

/**
 * Delay until the next open round becomes assignment-locked. Revisit very
 * distant deadlines at the browser's maximum timeout rather than relying on a
 * clamped timer that could fire immediately in a loop.
 */
export function nextAssignmentLockRefreshMs(
  plans: readonly Pick<PlanDTO, "status" | "closesAt">[],
  nowMs: number,
): number | null {
  const futureCloses = plans
    .flatMap((plan) => plan.status === "open" && plan.closesAt !== null
      ? [new Date(plan.closesAt).getTime()]
      : [])
    .filter((closesAt) => closesAt > nowMs);
  if (futureCloses.length === 0) return null;
  return Math.min(Math.min(...futureCloses) - nowMs + 25, 2_147_483_647);
}
