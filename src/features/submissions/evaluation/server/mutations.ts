import { sql, type SQL } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import type { EventId, PlanId, TrackId } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import type { PlanInput, ReviewerAssignmentInput } from "../types";

/**
 * Evaluation's writes.
 *
 * Each one is a single SQL statement, so a full-set replace — a round together
 * with its criteria, a plan's whole reviewer list — is atomic without a
 * transaction: `withTx` is confined to eight audited paths (PLAN's driver
 * resolution), and a data-modifying CTE gets the same all-or-nothing guarantee
 * over `neon-http`. Each statement also carries its own event scoping in the
 * `WHERE`, rather than trusting a preceding read.
 */

const UNIQUE_NAME = "evaluation_plans_event_id_name_key";

/**
 * Drizzle wraps the driver's error in one of its own and keeps the original as
 * `cause`, so the constraint name is a level or two down. Missing it turns
 * "you already have a Round 1" into a 500.
 */
function isUniqueNameViolation(error: unknown): boolean {
  for (let current: unknown = error, depth = 0; current && depth < 5; depth += 1) {
    const entry = current as { message?: unknown; constraint?: unknown; cause?: unknown };
    if (entry.constraint === UNIQUE_NAME) return true;
    if (typeof entry.message === "string" && entry.message.includes(UNIQUE_NAME)) return true;
    current = entry.cause;
  }
  return false;
}

/** Track scope is `null` for "every track"; an empty multi-select means the same thing. */
function normalizeTracks(trackIds: readonly TrackId[] | null): TrackId[] | null {
  return trackIds === null || trackIds.length === 0 ? null : [...trackIds];
}

/** A bound `uuid[]`, built element by element so no id is ever pasted into SQL. */
function uuidArraySql(ids: readonly string[] | null): SQL {
  if (ids === null) return sql`NULL::uuid[]`;
  if (ids.length === 0) return sql`'{}'::uuid[]`;
  return sql`ARRAY[${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}]`;
}

async function assertTracksInEvent(dbOrTx: DbOrTx, eventId: EventId, trackIds: readonly TrackId[] | null): Promise<void> {
  if (!trackIds || trackIds.length === 0) return;
  const result = await dbOrTx.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM tracks
    WHERE event_id = ${eventId} AND id IN (${sql.join(trackIds.map((id) => sql`${id}`), sql`, `)})
  `);
  if (Number((result.rows ?? [])[0]?.n ?? 0) !== new Set(trackIds).size) {
    throw new AppError("VALIDATION", "That track does not belong to this event");
  }
}

async function assertCriteriaInPlan(
  dbOrTx: DbOrTx,
  eventId: EventId,
  planId: PlanId | null,
  criterionIds: readonly string[],
): Promise<void> {
  if (criterionIds.length === 0) return;
  if (new Set(criterionIds).size !== criterionIds.length) {
    throw new AppError("VALIDATION", "A criterion can only appear once in an evaluation plan");
  }
  if (!planId) throw new AppError("VALIDATION", "Existing criteria can only be reused by their evaluation plan");
  const result = await dbOrTx.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM evaluation_criteria
    WHERE event_id = ${eventId} AND plan_id = ${planId}
      AND id IN (${sql.join(criterionIds.map((id) => sql`${id}`), sql`, `)})
  `);
  if (Number((result.rows ?? [])[0]?.n ?? 0) !== criterionIds.length) {
    throw new AppError("VALIDATION", "Every criterion id must belong to this evaluation plan");
  }
}

/**
 * Create or update a round together with its criteria, in one statement.
 * Criteria are matched by id rather than wiped and re-created: a review's
 * `criterion_scores` is keyed by criterion id, so re-creating them would orphan
 * every score already given under the old ids.
 */
export async function savePlanIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  input: PlanInput,
  expectedUpdatedAt?: string,
): Promise<{ planId: PlanId }> {
  const trackIds = normalizeTracks(input.trackIds);
  await assertTracksInEvent(dbOrTx, eventId, trackIds);

  const criteria = input.criteria.map((criterion, index) => ({
    id: criterion.id,
    label: criterion.label,
    weight: criterion.weight,
    sort_order: index,
  }));
  const keepIds = criteria.flatMap((criterion) => criterion.id ? [criterion.id] : []);
  await assertCriteriaInPlan(dbOrTx, eventId, input.planId, keepIds);

  let rows: Array<{ id: string }>;
  try {
    const result = await dbOrTx.execute<{ id: string }>(sql`
      WITH saved AS (
        INSERT INTO evaluation_plans (id, event_id, name, round, scale_min, scale_max, status, track_ids)
        VALUES (COALESCE(${input.planId}::uuid, gen_random_uuid()), ${eventId}, ${input.name}, ${input.round},
                ${input.scaleMin}, ${input.scaleMax}, ${input.status}, ${uuidArraySql(trackIds)})
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name, round = EXCLUDED.round, scale_min = EXCLUDED.scale_min,
          scale_max = EXCLUDED.scale_max, status = EXCLUDED.status, track_ids = EXCLUDED.track_ids,
          updated_at = now()
        WHERE evaluation_plans.event_id = ${eventId}
          AND (${expectedUpdatedAt ?? null}::timestamptz IS NULL OR evaluation_plans.updated_at = ${expectedUpdatedAt ?? null}::timestamptz)
        RETURNING id
      ),
      dropped AS (
        DELETE FROM evaluation_criteria c USING saved
        WHERE c.plan_id = saved.id AND c.event_id = ${eventId}
          AND c.id <> ALL(${uuidArraySql(keepIds)})
      ),
      kept AS (
        INSERT INTO evaluation_criteria (id, event_id, plan_id, label, weight, sort_order)
        SELECT COALESCE(incoming.id, gen_random_uuid()), ${eventId}, saved.id, incoming.label, incoming.weight, incoming.sort_order
        FROM saved, jsonb_to_recordset(${JSON.stringify(criteria)}::jsonb)
          AS incoming(id uuid, label text, weight numeric, sort_order int)
        ON CONFLICT (id) DO UPDATE SET
          label = EXCLUDED.label, weight = EXCLUDED.weight, sort_order = EXCLUDED.sort_order
        WHERE evaluation_criteria.event_id = EXCLUDED.event_id
          AND evaluation_criteria.plan_id = EXCLUDED.plan_id
      )
      SELECT id FROM saved
    `);
    rows = result.rows ?? [];
  } catch (error) {
    if (isUniqueNameViolation(error)) {
      throw new AppError("VALIDATION", `This event already has a round called “${input.name}”`, { fieldErrors: { name: "Already used by another round" } });
    }
    throw error;
  }

  const planId = rows[0]?.id;
  if (!planId) {
    // The insert wrote nothing, so the conflicting row is either somebody else's
    // event or a newer version of this plan. Say which.
    const existing = await dbOrTx.execute<{ event_id: string; updated_at: string }>(sql`
      SELECT event_id, updated_at FROM evaluation_plans WHERE id = ${input.planId}
    `);
    const row = (existing.rows ?? [])[0];
    if (!row || row.event_id !== eventId) throw new AppError("NOT_FOUND", "Evaluation plan not found");
    throw new AppError("STALE_WRITE", "Someone else changed this round while you were editing it");
  }
  return { planId: planId as PlanId };
}

/**
 * Rounds with scores in them are closed, never deleted: the alternative silently
 * discards reviewers' work through a button labelled "Delete plan".
 */
export async function deletePlanIn(dbOrTx: DbOrTx, eventId: EventId, planId: PlanId): Promise<void> {
  const result = await dbOrTx.execute<{ id: string }>(sql`
    DELETE FROM evaluation_plans p
    WHERE p.id = ${planId} AND p.event_id = ${eventId}
      AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.plan_id = p.id)
    RETURNING p.id
  `);
  if ((result.rows ?? []).length > 0) return;

  const counted = await dbOrTx.execute<{ n: number }>(sql`
    SELECT count(r.id)::int AS n FROM evaluation_plans p
    LEFT JOIN reviews r ON r.plan_id = p.id
    WHERE p.id = ${planId} AND p.event_id = ${eventId}
    GROUP BY p.id
  `);
  const reviews = (counted.rows ?? [])[0];
  if (!reviews) throw new AppError("NOT_FOUND", "Evaluation plan not found");
  throw new AppError("CONFLICT", `This plan has ${reviews.n} review${Number(reviews.n) === 1 ? "" : "s"} — close it instead`);
}

/**
 * Replaces the plan's reviewer set wholesale. Reassigning tracks changes what a
 * reviewer sees next, never what they already scored: removing an assignment
 * drops the routing row and leaves every `reviews` row standing.
 */
export async function assignReviewersIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  planId: PlanId,
  assignments: readonly ReviewerAssignmentInput[],
): Promise<void> {
  if (new Set(assignments.map((assignment) => assignment.userId)).size !== assignments.length) {
    throw new AppError("VALIDATION", "A reviewer can only be assigned once per evaluation plan");
  }
  for (const assignment of assignments) await assertTracksInEvent(dbOrTx, eventId, assignment.trackIds);
  const incoming = assignments.map((assignment) => ({
    user_id: assignment.userId,
    track_ids: normalizeTracks(assignment.trackIds),
  }));

  const result = await dbOrTx.execute<{ plan_found: number; matched: number }>(sql`
    WITH plan AS (
      SELECT id FROM evaluation_plans WHERE id = ${planId} AND event_id = ${eventId}
    ),
    incoming AS (
      SELECT x.user_id, x.track_ids FROM jsonb_to_recordset(${JSON.stringify(incoming)}::jsonb)
        AS x(user_id uuid, track_ids uuid[])
    ),
    -- Only members of this event may be routed submissions; an unknown user id
    -- is a mistake worth reporting, not a row worth writing.
    members AS (
      SELECT i.user_id, i.track_ids FROM incoming i
      JOIN event_members m ON m.user_id = i.user_id AND m.event_id = ${eventId}
    ),
    valid AS (
      SELECT (SELECT count(*) FROM incoming) = (SELECT count(*) FROM members) AS ok
    ),
    removed AS (
      DELETE FROM reviewer_assignments a USING plan
      WHERE (SELECT ok FROM valid) AND a.plan_id = plan.id
        AND a.user_id NOT IN (SELECT user_id FROM members)
    ),
    upserted AS (
      INSERT INTO reviewer_assignments (event_id, plan_id, user_id, track_ids)
      SELECT ${eventId}, plan.id, members.user_id, members.track_ids FROM plan, members
      WHERE (SELECT ok FROM valid)
      ON CONFLICT (plan_id, user_id) DO UPDATE SET track_ids = EXCLUDED.track_ids
    )
    SELECT (SELECT count(*)::int FROM plan) AS plan_found, (SELECT count(*)::int FROM members) AS matched
  `);

  const summary = (result.rows ?? [])[0];
  if (!summary || Number(summary.plan_found) === 0) throw new AppError("NOT_FOUND", "Evaluation plan not found");
  if (Number(summary.matched) !== assignments.length) {
    throw new AppError("VALIDATION", "Every reviewer has to be a member of this event");
  }
}

export const savePlan = (eventId: EventId, input: PlanInput, expectedUpdatedAt?: string) =>
  savePlanIn(db, eventId, input, expectedUpdatedAt);
export const deletePlan = (eventId: EventId, planId: PlanId) => deletePlanIn(db, eventId, planId);
export const assignReviewers = (eventId: EventId, planId: PlanId, assignments: readonly ReviewerAssignmentInput[]) =>
  assignReviewersIn(db, eventId, planId, assignments);
