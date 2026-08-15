import type { StatusBadgeValue } from "@/shared/ui/status-badge";
import { reviewWindow } from "./scoring";
import type { PlanDTO } from "./types";

/**
 * What a round's STATUS chip says.
 *
 * `plan.status` alone is the organizer's intent, not the reviewer's reality: a
 * round marked open whose window has not started is one nobody can work, and
 * one whose close date has passed accepts no further saves. The chip is the
 * element that reads as the state, so it has to agree with what the reviewer
 * surface tells the committee. The window itself is derived by `reviewWindow`,
 * the same half-open rule the server re-checks on every write.
 */
export function planStatusBadge(
  plan: Pick<PlanDTO, "status" | "opensAt" | "closesAt">,
  now: Date = new Date(),
): StatusBadgeValue {
  if (plan.status !== "open") return "closed";
  const { state } = reviewWindow(plan, now);
  return state === "before_open" ? "scheduled" : state === "closed" ? "ended" : "open";
}
