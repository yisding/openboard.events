import { sql, type SQL } from "drizzle-orm";

/**
 * Is this review assignment still real work?
 *
 * Two halves, and only the reviewer's own queue ever carried both. An
 * assignment is live (`ra.status = 'assigned'` — a recusal stays on the row for
 * the audit trail but stops being work) *and* its submission can still be
 * scored. A speaker who withdraws mid-review-week leaves the assignment row
 * behind: the queue hides it, but the reviewer's nav badge counted it, the
 * reminder preflight listed it, `sendReviewReminders` mailed about it, and the
 * plan's progress row sat at 5/6 forever with nothing the reviewer could do.
 *
 * Written as an `EXISTS` rather than a join so every caller can apply it
 * without restructuring its own query; each one aliases the assignment table
 * `ra`. It lives beside `db/errors.ts` and `db/query-result.ts` because four
 * features ask this question and none of them owns it.
 */
export const OUTSTANDING_REVIEW_WORK_SQL: SQL = sql`
  ra.status = 'assigned'
  AND EXISTS (
    SELECT 1 FROM submissions scorable
    WHERE scorable.id = ra.submission_id
      AND scorable.event_id = ra.event_id
      AND scorable.status NOT IN ('draft', 'withdrawn')
  )
`;
