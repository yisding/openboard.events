export type StatusBadgeTone = "success" | "review" | "queued" | "danger" | "warning" | "neutral";

type StatusBadgeDefinition = Readonly<{
  label: string;
  tone: StatusBadgeTone;
}>;

/**
 * The complete vocabulary that may render through StatusBadge.
 *
 * Labels are deliberately authored instead of inferred from backend keys, and
 * tones describe outcomes rather than reusing the jade interaction state.
 * Adding a backend enum value therefore becomes a type error at its call site
 * until its user-facing language and semantic tone are chosen here.
 */
export const STATUS_BADGES = {
  draft: { label: "Draft", tone: "neutral" },
  pending: { label: "Pending review", tone: "review" },
  accept_queue: { label: "Queued to accept", tone: "queued" },
  decline_queue: { label: "Queued to decline", tone: "queued" },
  accepted: { label: "Accepted", tone: "success" },
  declined: { label: "Declined", tone: "danger" },
  withdrawn: { label: "Withdrawn", tone: "neutral" },

  open: { label: "Open", tone: "success" },
  live: { label: "Live", tone: "success" },
  scheduled: { label: "Scheduled", tone: "review" },
  closed: { label: "Closed", tone: "neutral" },
  ended: { label: "Ended", tone: "neutral" },
  published: { label: "Published", tone: "success" },

  unconfirmed: { label: "Awaiting confirmation", tone: "review" },
  confirmed: { label: "Confirmed", tone: "success" },
  new: { label: "New", tone: "neutral" },
  contacted: { label: "Contacted", tone: "review" },
  invited: { label: "Invited", tone: "review" },

  queued: { label: "Queued", tone: "queued" },
  sent: { label: "Sent", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  skipped: { label: "Skipped", tone: "neutral" },
  bounced: { label: "Bounced", tone: "danger" },
  complained: { label: "Spam complaint", tone: "danger" },
  processing: { label: "Processing", tone: "review" },
  completed: { label: "Completed", tone: "success" },

  complete: { label: "Complete", tone: "success" },
  ready: { label: "Ready", tone: "success" },
  overdue: { label: "Overdue", tone: "danger" },
  locked: { label: "Locked", tone: "neutral" },
  unplaced: { label: "Needs placement", tone: "warning" },
  applied: { label: "Applied", tone: "success" },
  changed: { label: "Changed", tone: "warning" },
  stale: { label: "Changed", tone: "warning" },
  duplicate: { label: "Duplicate", tone: "warning" },
  error: { label: "Error", tone: "danger" },

  current_device: { label: "This device", tone: "success" },
  owner: { label: "Owner", tone: "neutral" },
  organizer: { label: "Organizer", tone: "neutral" },
  reviewer: { label: "Reviewer", tone: "neutral" },
  current_plan: { label: "Current plan", tone: "success" },
  trialing: { label: "Trial", tone: "review" },
  active: { label: "Active", tone: "success" },
  past_due: { label: "Past due", tone: "warning" },
  canceled: { label: "Canceled", tone: "neutral" },

  manual: { label: "Manual", tone: "neutral" },
  form: { label: "Form response", tone: "neutral" },
  file_request: { label: "File request", tone: "neutral" },
  event_sync: { label: "Event sync", tone: "neutral" },
  import: { label: "Imported", tone: "neutral" },
  merge: { label: "Merged", tone: "neutral" },
  matched_existing: { label: "Matched", tone: "neutral" },
  duplicate_in_file: { label: "Duplicate", tone: "warning" },
  created: { label: "New", tone: "success" },
} as const satisfies Record<string, StatusBadgeDefinition>;

export type StatusBadgeValue = keyof typeof STATUS_BADGES;

/** The same authored label a badge would render, for the places that need the
 * words without the chip — a timeline sentence, a CSV cell, a search result's
 * secondary line. Going through here keeps those surfaces from inventing a
 * second vocabulary for a status the badge already names. */
export function statusBadgeLabel(value: StatusBadgeValue): string {
  return STATUS_BADGES[value].label;
}

/** Speaker-facing APIs intentionally return display labels after hiding the
 * two internal decision queues. Keep that boundary, then translate its closed
 * vocabulary back to semantic badge ids explicitly at the rendering edge. */
export const PORTAL_STATUS_BADGES = {
  Draft: "draft",
  Pending: "pending",
  Accepted: "accepted",
  Declined: "declined",
  Withdrawn: "withdrawn",
} as const satisfies Record<string, StatusBadgeValue>;
