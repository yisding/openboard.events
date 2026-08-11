import { sql, type SQLWrapper } from "drizzle-orm";
import { db } from "@/db/client";
import type { EventId, UserId } from "@/shared/contracts";

/**
 * M56 — sidebar nav badges. Every number here is *actionable* (unreviewed,
 * overdue, missing), never a total: a badge that just repeats a KPI teaches
 * the organizer to ignore it. Reads the same views the dashboard reads
 * (`submission_status_counts_v`, `missing_assets_v`, `task_assignments_v`),
 * so a number here can never disagree with the dashboard's own count.
 */
export type NavCounts = {
  abstractsPending: number;
  speakersMissing: number;
  tasksOverdue: number;
};

export type NavCountsDb = {
  execute(query: SQLWrapper | string): PromiseLike<{ rows: Record<string, unknown>[] }>;
};

function toInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Organizer/owner badges: Abstracts, Speakers, Tasks. One statement, no waterfall. */
export async function getNavCountsIn(dbOrTx: NavCountsDb, eventId: EventId): Promise<NavCounts> {
  const result = await dbOrTx.execute(sql`
    SELECT
      (SELECT coalesce(sum(n), 0)::int FROM submission_status_counts_v WHERE event_id = ${eventId} AND status = 'pending') AS abstracts_pending,
      (SELECT count(*)::int FROM missing_assets_v WHERE event_id = ${eventId} AND (missing_bio OR missing_headshot)) AS speakers_missing,
      (SELECT count(*)::int FROM task_assignments_v WHERE event_id = ${eventId} AND overdue) AS tasks_overdue
  `);
  const row = result.rows[0];
  return {
    abstractsPending: toInt(row?.abstracts_pending),
    speakersMissing: toInt(row?.speakers_missing),
    tasksOverdue: toInt(row?.tasks_overdue),
  };
}

/**
 * Reviewer badge: their own still-open, unscored work — assigned rows with no
 * submitted review, in a round they can currently save into. A recused or
 * closed-round assignment is not something clicking "Review queue" fixes, so
 * neither counts.
 */
export async function getReviewerQueueCountIn(dbOrTx: NavCountsDb, eventId: EventId, reviewerUserId: UserId): Promise<number> {
  const result = await dbOrTx.execute(sql`
    SELECT count(*)::int AS n
    FROM review_assignments ra
    JOIN evaluation_plans p ON p.id = ra.plan_id AND p.event_id = ra.event_id
    LEFT JOIN reviews r ON r.plan_id = ra.plan_id AND r.submission_id = ra.submission_id AND r.reviewer_user_id = ra.reviewer_user_id
    WHERE ra.event_id = ${eventId} AND ra.reviewer_user_id = ${reviewerUserId}
      AND ra.status = 'assigned'
      AND p.status = 'open'
      AND (p.opens_at IS NULL OR p.opens_at <= now())
      AND (p.closes_at IS NULL OR p.closes_at > now())
      AND r.submitted_at IS NULL
  `);
  return toInt(result.rows[0]?.n);
}

export const getNavCounts = (eventId: EventId) => getNavCountsIn(db, eventId);
export const getReviewerQueueCount = (eventId: EventId, reviewerUserId: UserId) => getReviewerQueueCountIn(db, eventId, reviewerUserId);
