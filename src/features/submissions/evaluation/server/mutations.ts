import { sql, type SQL } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import type { EventId, PlanId, ReviewId, SubmissionId, TrackId, UserId } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { weightedOverall } from "../scoring";
import type { PlanInput, ReviewInput, ReviewerAssignmentInput } from "../types";

/**
 * Evaluation's writes.
 *
 * Each one is a single SQL statement, so a full-set replace — a round together
 * with its criteria, a plan's whole reviewer list — is atomic without a
 * transaction: `withTx` is confined to eight audited paths (PLAN's driver
 * resolution), and a data-modifying CTE gets the same all-or-nothing guarantee
 * over `neon-http`. The statements are also self-guarding — `submitReview`'s
 * scope and status checks live in its `WHERE`, not in a preceding read — so a
 * round that closes mid-request cannot let one more score through.
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
  const result = await dbOrTx.execute<{ plan_found: boolean; matching: number; existing: number }>(sql`
    SELECT
      EXISTS (SELECT 1 FROM evaluation_plans WHERE id = ${planId} AND event_id = ${eventId}) AS plan_found,
      (SELECT count(*)::int FROM evaluation_criteria
       WHERE event_id = ${eventId} AND plan_id = ${planId}
         AND id IN (${sql.join(criterionIds.map((id) => sql`${id}`), sql`, `)})) AS matching,
      (SELECT count(*)::int FROM evaluation_criteria
       WHERE id IN (${sql.join(criterionIds.map((id) => sql`${id}`), sql`, `)})) AS existing
  `);
  const summary = (result.rows ?? [])[0];
  if (!summary?.plan_found && Number(summary?.existing ?? 0) === 0) return;
  if (!summary?.plan_found || Number(summary.matching) !== criterionIds.length) {
    throw new AppError("VALIDATION", "Every criterion id must belong to this evaluation plan");
  }
}

type PersistedScoringShape = {
  scale_min: number;
  scale_max: number;
  has_reviews: boolean;
  criteria: Array<{ id: string; weight: number }>;
};

async function assertScoringShapeEditable(dbOrTx: DbOrTx, eventId: EventId, input: PlanInput): Promise<void> {
  if (!input.planId) return;
  const result = await dbOrTx.execute<PersistedScoringShape>(sql`
    SELECT p.scale_min, p.scale_max,
      EXISTS (SELECT 1 FROM reviews r WHERE r.plan_id = p.id) AS has_reviews,
      COALESCE((
        SELECT json_agg(json_build_object('id', c.id, 'weight', c.weight::float8) ORDER BY c.id)
        FROM evaluation_criteria c WHERE c.plan_id = p.id AND c.event_id = p.event_id
      ), '[]'::json) AS criteria
    FROM evaluation_plans p
    WHERE p.id = ${input.planId} AND p.event_id = ${eventId}
  `);
  const current = (result.rows ?? [])[0];
  if (!current?.has_reviews) return;

  const incoming = new Map<string, number>(input.criteria.flatMap((criterion) =>
    criterion.id ? [[criterion.id, Number(criterion.weight)] as const] : []));
  const formulaIsUnchanged = Number(current.scale_min) === input.scaleMin
    && Number(current.scale_max) === input.scaleMax
    && incoming.size === input.criteria.length
    && incoming.size === current.criteria.length
    && current.criteria.every((criterion) => incoming.get(criterion.id) === Number(criterion.weight));
  if (!formulaIsUnchanged) {
    throw new AppError(
      "CONFLICT",
      "This round already has reviews. Create a new round to change its scale, criteria, or criterion weights.",
    );
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
  await assertScoringShapeEditable(dbOrTx, eventId, input);

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

type PlanShape = {
  scale_min: number; scale_max: number;
  criteria: Array<{ id: string; weight: number }> | null;
};

function assertInScale(score: number, plan: PlanShape, label: string): void {
  if (!Number.isFinite(score) || score < Number(plan.scale_min) || score > Number(plan.scale_max)) {
    throw new AppError("VALIDATION", `${label} has to be between ${plan.scale_min} and ${plan.scale_max}`);
  }
}

/**
 * One reviewer's verdict on one submission in one round, upserted on
 * `(plan, submission, reviewer)`. The unique index plus `ON CONFLICT` is what
 * makes a double-submit an update instead of a second row — no "have they
 * already scored this?" pre-read, which is the version of this that races.
 */
export async function submitReviewIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  planId: PlanId,
  submissionId: SubmissionId,
  reviewerUserId: UserId,
  input: Omit<ReviewInput, "planId" | "submissionId">,
): Promise<{ reviewId: ReviewId; overallScore: number | null }> {
  const planRows = await dbOrTx.execute<PlanShape>(sql`
    SELECT p.scale_min, p.scale_max,
      (SELECT json_agg(json_build_object('id', c.id, 'weight', c.weight::float8))
       FROM evaluation_criteria c WHERE c.plan_id = p.id) AS criteria
    FROM evaluation_plans p WHERE p.id = ${planId} AND p.event_id = ${eventId}
  `);
  const plan = (planRows.rows ?? [])[0];
  if (!plan) throw new AppError("NOT_FOUND", "Evaluation plan not found");
  const criteria = plan.criteria ?? [];

  const scores: Record<string, number> = {};
  for (const [criterionId, score] of Object.entries(input.criterionScores)) {
    if (!criteria.some((criterion) => criterion.id === criterionId)) {
      throw new AppError("VALIDATION", "That criterion is not part of this round");
    }
    assertInScale(score, plan, "Every criterion score");
    scores[criterionId] = score;
  }

  // With criteria, the overall score is derived — the client may preview it, but
  // the number that is stored is the one the server computed.
  let overall: number | null;
  if (criteria.length > 0) {
    overall = weightedOverall(criteria.map((criterion) => ({ id: criterion.id, weight: Number(criterion.weight) })), scores);
  } else {
    overall = input.overallScore;
    if (overall !== null) assertInScale(overall, plan, "The score");
  }

  const result = await dbOrTx.execute<{ id: string }>(sql`
    INSERT INTO reviews (event_id, plan_id, submission_id, reviewer_user_id, overall_score, criterion_scores, comment, submitted_at)
    SELECT ${eventId}, p.id, s.id, ${reviewerUserId}, ${overall}, ${JSON.stringify(scores)}::jsonb, ${input.comment}, now()
    FROM evaluation_plans p
    JOIN submissions s ON s.event_id = p.event_id AND s.id = ${submissionId}
    JOIN reviewer_assignments a ON a.plan_id = p.id AND a.user_id = ${reviewerUserId}
    WHERE p.id = ${planId} AND p.event_id = ${eventId} AND p.status = 'open'
      AND s.status NOT IN ('draft', 'withdrawn')
      AND (p.track_ids IS NULL OR s.track_id = ANY(p.track_ids))
      AND (a.track_ids IS NULL OR s.track_id = ANY(a.track_ids))
    ON CONFLICT (plan_id, submission_id, reviewer_user_id) DO UPDATE SET
      overall_score = EXCLUDED.overall_score, criterion_scores = EXCLUDED.criterion_scores,
      comment = EXCLUDED.comment, submitted_at = now(), updated_at = now()
    RETURNING id
  `);

  const reviewId = (result.rows ?? [])[0]?.id;
  if (!reviewId) throw await scoringRefusal(dbOrTx, eventId, planId, submissionId, reviewerUserId);
  return { reviewId: reviewId as ReviewId, overallScore: overall };
}

/**
 * Why the guarded insert matched nothing. Asked only on the failure path, so the
 * write stays one statement and the reviewer still gets a reason rather than a
 * silent no-op.
 */
async function scoringRefusal(
  dbOrTx: DbOrTx,
  eventId: EventId,
  planId: PlanId,
  submissionId: SubmissionId,
  reviewerUserId: UserId,
): Promise<AppError> {
  const result = await dbOrTx.execute<{
    plan_status: string | null; submission_status: string | null; assigned: boolean; in_scope: boolean;
  }>(sql`
    SELECT p.status AS plan_status, s.status AS submission_status,
      (a.user_id IS NOT NULL) AS assigned,
      (a.user_id IS NOT NULL AND s.id IS NOT NULL
        AND (p.track_ids IS NULL OR s.track_id = ANY(p.track_ids))
        AND (a.track_ids IS NULL OR s.track_id = ANY(a.track_ids))) AS in_scope
    FROM evaluation_plans p
    LEFT JOIN submissions s ON s.event_id = p.event_id AND s.id = ${submissionId}
    LEFT JOIN reviewer_assignments a ON a.plan_id = p.id AND a.user_id = ${reviewerUserId}
    WHERE p.id = ${planId} AND p.event_id = ${eventId}
  `);
  const row = (result.rows ?? [])[0];
  if (!row) return new AppError("NOT_FOUND", "Evaluation plan not found");
  if (row.plan_status !== "open") return new AppError("CONFLICT", "This round is closed");
  if (!row.submission_status) return new AppError("NOT_FOUND", "Submission not found");
  if (row.submission_status === "draft" || row.submission_status === "withdrawn") {
    return new AppError("CONFLICT", `A ${row.submission_status} submission cannot be scored`);
  }
  if (!row.assigned) return new AppError("FORBIDDEN", "You are not a reviewer on this round");
  if (!row.in_scope) return new AppError("FORBIDDEN", "That submission is not routed to you");
  return new AppError("INTERNAL", "The review could not be saved");
}

export const savePlan = (eventId: EventId, input: PlanInput, expectedUpdatedAt?: string) =>
  savePlanIn(db, eventId, input, expectedUpdatedAt);
export const deletePlan = (eventId: EventId, planId: PlanId) => deletePlanIn(db, eventId, planId);
export const assignReviewers = (eventId: EventId, planId: PlanId, assignments: readonly ReviewerAssignmentInput[]) =>
  assignReviewersIn(db, eventId, planId, assignments);
export const submitReview = (
  eventId: EventId,
  planId: PlanId,
  submissionId: SubmissionId,
  reviewerUserId: UserId,
  input: Omit<ReviewInput, "planId" | "submissionId">,
) => submitReviewIn(db, eventId, planId, submissionId, reviewerUserId, input);
