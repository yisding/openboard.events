import type { SubmissionStatus } from "@/shared/contracts";

export const SUBMISSION_VIEWS = ["needs_decision", "ready_to_notify", "decided", "all"] as const;
export type SubmissionView = (typeof SUBMISSION_VIEWS)[number];

/** Pure view-layer mapping shared by server parsing and client URL controls. */
export function submissionViewForStatus(status: SubmissionStatus | "all"): SubmissionView {
  if (status === "pending") return "needs_decision";
  if (status === "accept_queue" || status === "decline_queue") return "ready_to_notify";
  if (status === "accepted" || status === "declined" || status === "withdrawn") return "decided";
  return "all";
}
