import type { SubmissionStatus } from "./enums";

// Keep byte-for-byte transition parity with guard_submission_transition() in
// drizzle/0001_views_triggers.sql; the schema acceptance suite checks all 49 pairs.
export const SUBMISSION_TRANSITIONS: Record<SubmissionStatus, readonly SubmissionStatus[]> = {
  draft: ["pending", "withdrawn"],
  pending: ["accept_queue", "decline_queue", "accepted", "declined", "withdrawn"],
  accept_queue: ["pending", "decline_queue", "accepted", "declined", "withdrawn"],
  decline_queue: ["pending", "accept_queue", "accepted", "declined", "withdrawn"],
  accepted: ["pending", "accept_queue", "decline_queue", "declined", "withdrawn"],
  declined: ["pending", "accept_queue", "decline_queue", "accepted"],
  withdrawn: ["pending"],
};

export const FINAL_STATUSES = ["accepted", "declined"] as const;

export const PORTAL_STATUS_LABEL: Record<SubmissionStatus, string> = {
  draft: "Draft",
  pending: "Pending",
  accept_queue: "Pending",
  decline_queue: "Pending",
  accepted: "Accepted",
  declined: "Declined",
  withdrawn: "Withdrawn",
};

export function canTransition(from: SubmissionStatus, to: SubmissionStatus): boolean {
  return from === to || SUBMISSION_TRANSITIONS[from].includes(to);
}
