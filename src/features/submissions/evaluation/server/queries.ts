import { sql, type SQL } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import type { EventId, PlanId, SubmissionId } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import type { PlanDTO } from "../types";

/**
 * Evaluation's reads. Every one is event-scoped, and every aggregate is scoped
 * to a single plan: two rounds over the same abstract are two independent
 * verdicts, and averaging them together would report a number no reviewer ever
 * gave.
 */

/**
 * The plan the Abstracts table's Rating column means. Open rounds win over
 * closed ones, then the lowest round — so a Round 2 opened alongside Round 1
 * does not silently retitle the column's meaning by id order.
 */
export function activePlanIdSql(eventId: EventId): SQL {
  return sql`(
    SELECT p.id FROM evaluation_plans p
    WHERE p.event_id = ${eventId}
    ORDER BY (p.status = 'open') DESC, p.round ASC, p.created_at ASC
    LIMIT 1
  )`;
}

/**
 * The effective scope rule in SQL — the same predicate as `inReviewerScope`,
 * expressed over the columns. `planTracks`/`assignmentTracks` are the track
 * arrays to test against; `NULL` on either means "every track".
 */
function scopeClause(planTracks: SQL, assignmentTracks: SQL): SQL {
  return sql`s.status NOT IN ('draft', 'withdrawn')
    AND (${planTracks} IS NULL OR s.track_id = ANY(${planTracks}))
    AND (${assignmentTracks} IS NULL OR s.track_id = ANY(${assignmentTracks}))`;
}

type PlanRow = {
  id: string; name: string; round: number; scale_min: number; scale_max: number;
  status: PlanDTO["status"]; track_ids: string[] | null;
  criteria: PlanDTO["criteria"] | null; reviewers: PlanDTO["reviewers"] | null;
  scored: number; total: number; updated_at: string;
};

function toPlan(row: PlanRow): PlanDTO {
  return {
    id: row.id as PlanId,
    name: row.name,
    round: Number(row.round),
    scaleMin: Number(row.scale_min),
    scaleMax: Number(row.scale_max),
    status: row.status,
    trackIds: (row.track_ids ?? null) as PlanDTO["trackIds"],
    criteria: (row.criteria ?? []).map((criterion) => ({ ...criterion, weight: Number(criterion.weight), sortOrder: Number(criterion.sortOrder) })),
    reviewers: (row.reviewers ?? []).map((reviewer) => ({
      ...reviewer,
      trackIds: reviewer.trackIds ?? null,
      scored: Number(reviewer.scored),
      assigned: Number(reviewer.assigned),
    })),
    progress: { scored: Number(row.scored), total: Number(row.total) },
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

async function selectPlans(dbOrTx: DbOrTx, eventId: EventId, only?: SQL): Promise<PlanDTO[]> {
  const result = await dbOrTx.execute<PlanRow>(sql`
    SELECT p.id, p.name, p.round, p.scale_min, p.scale_max, p.status, p.track_ids, p.updated_at,
      COALESCE((
        SELECT json_agg(json_build_object('id', c.id, 'label', c.label, 'weight', c.weight::float8, 'sortOrder', c.sort_order)
                        ORDER BY c.sort_order, c.label)
        FROM evaluation_criteria c WHERE c.plan_id = p.id AND c.event_id = p.event_id
      ), '[]'::json) AS criteria,
      COALESCE((
        SELECT json_agg(json_build_object(
                 'userId', a.user_id, 'name', u.name, 'email', u.email, 'trackIds', a.track_ids,
                 -- Progress is per reviewer over *their* slice of the round, not
                 -- over the whole round: a reviewer scoped to one track has
                 -- finished when that track is done.
                 'assigned', (SELECT count(*) FROM submissions s
                              WHERE s.event_id = p.event_id AND ${scopeClause(sql`p.track_ids`, sql`a.track_ids`)}),
                 'scored', (SELECT count(*) FROM reviews r
                            JOIN submissions s ON s.id = r.submission_id AND s.event_id = r.event_id
                            WHERE r.plan_id = p.id AND r.reviewer_user_id = a.user_id AND r.overall_score IS NOT NULL
                              AND ${scopeClause(sql`p.track_ids`, sql`a.track_ids`)})
               ) ORDER BY lower(u.name), u.email)
        FROM reviewer_assignments a
        JOIN users u ON u.id = a.user_id
        WHERE a.plan_id = p.id AND a.event_id = p.event_id
      ), '[]'::json) AS reviewers,
      (SELECT count(*)::int FROM submissions s
       WHERE s.event_id = p.event_id AND ${scopeClause(sql`p.track_ids`, sql`NULL::uuid[]`)}) AS total,
      (SELECT count(DISTINCT r.submission_id)::int FROM reviews r
       WHERE r.plan_id = p.id AND r.overall_score IS NOT NULL) AS scored
    FROM evaluation_plans p
    WHERE p.event_id = ${eventId} ${only ? sql`AND ${only}` : sql``}
    ORDER BY p.round, lower(p.name)
  `);
  return (result.rows ?? []).map(toPlan);
}

export function listPlansIn(dbOrTx: DbOrTx, eventId: EventId): Promise<PlanDTO[]> {
  return selectPlans(dbOrTx, eventId);
}

export async function getPlanIn(dbOrTx: DbOrTx, eventId: EventId, planId: PlanId): Promise<PlanDTO> {
  const [plan] = await selectPlans(dbOrTx, eventId, sql`p.id = ${planId}`);
  if (!plan) throw new AppError("NOT_FOUND", "Evaluation plan not found");
  return plan;
}

export async function getActivePlanIn(dbOrTx: DbOrTx, eventId: EventId): Promise<PlanDTO | null> {
  const [plan] = await selectPlans(dbOrTx, eventId, sql`p.id = ${activePlanIdSql(eventId)}`);
  return plan ?? null;
}

/**
 * One plan's ratings, straight off `submission_ratings_v`. Submissions with no
 * finished review are absent rather than zero — the caller renders them as `—`,
 * and a missing verdict never drags an average down.
 */
export async function getRatingsIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  planId: PlanId,
): Promise<Map<SubmissionId, { rating: number; nScores: number }>> {
  const result = await dbOrTx.execute<{ submission_id: string; rating: number; n_scores: number }>(sql`
    SELECT submission_id, rating, n_scores FROM submission_ratings_v
    WHERE event_id = ${eventId} AND plan_id = ${planId}
  `);
  return new Map((result.rows ?? []).map((row) => [
    row.submission_id as SubmissionId,
    { rating: Number(row.rating), nScores: Number(row.n_scores) },
  ]));
}

export const listPlans = (eventId: EventId) => listPlansIn(db, eventId);
export const getPlan = (eventId: EventId, planId: PlanId) => getPlanIn(db, eventId, planId);
export const getActivePlan = (eventId: EventId) => getActivePlanIn(db, eventId);
export const getRatings = (eventId: EventId, planId: PlanId) => getRatingsIn(db, eventId, planId);
