import type { SubmissionListRow, SubmissionStatus } from "@/shared/contracts";

/**
 * What the Submissions screen is showing right now: the rows, the workflow tab
 * counts computed over the same filter, and the event-wide queue depth the
 * Notify button carries.
 */
export type AbstractsListSnapshot = {
  rows: SubmissionListRow[];
  counts: Record<SubmissionStatus | "all", number>;
  /** Event-wide `accept_queue + decline_queue` — Notify is event-wide. */
  queued: number;
};

const FINAL_STATUSES: readonly SubmissionStatus[] = ["accepted", "declined"];
const QUEUE_STATUSES: readonly SubmissionStatus[] = ["accept_queue", "decline_queue"];

/**
 * Fold a confirmed bulk transition into the list the organizer is looking at.
 *
 * `router.refresh()` alone left this table repeating the statuses the decision
 * bar had just changed: the toast said "1 moved" while the row under it still
 * read "Pending review" and the Ready to notify tab still read 0, and only a
 * manual reload agreed with the server. The transition endpoint already answers
 * with the ids it moved, so those rows — and the two counters derived from them
 * — are corrected the moment the mutation succeeds. The next server snapshot
 * still has the last word, so a concurrent organizer's work is never lost.
 *
 * Only ids the server confirmed as `changed` are folded, and only rows already
 * on screen: every selectable row is one of them, which is what makes the tab
 * counts (filtered) and the queue depth (event-wide) exact rather than
 * approximate. `stale` ids are deliberately left alone — the server refused to
 * move them because somebody else already had, and guessing their new status
 * here would invent one.
 */
export function withDecidedRows(
  snapshot: AbstractsListSnapshot,
  changedIds: readonly string[],
  to: SubmissionStatus,
): AbstractsListSnapshot {
  if (changedIds.length === 0) return snapshot;
  const moved = new Set<string>(changedIds);
  const counts = { ...snapshot.counts };
  let queued = snapshot.queued;
  let touched = false;

  const rows = snapshot.rows.map((row) => {
    if (!moved.has(row.submissionId) || row.status === to) return row;
    touched = true;
    counts[row.status] -= 1;
    counts[to] += 1;
    queued += (QUEUE_STATUSES.includes(to) ? 1 : 0) - (QUEUE_STATUSES.includes(row.status) ? 1 : 0);
    return {
      ...row,
      status: to,
      // The same rule the SQL applies: undoing a final decision clears
      // `notified_at`, because a later re-notify has to be a new email rather
      // than a suppressed duplicate. The Notified column says so immediately.
      notifiedAt: FINAL_STATUSES.includes(row.status) && !FINAL_STATUSES.includes(to) ? null : row.notifiedAt,
    };
  });

  return touched ? { rows, counts, queued } : snapshot;
}
