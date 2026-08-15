import { sql, type SQL } from "drizzle-orm";
import { db, withTx, type DbOrTx } from "@/db/client";
import { isConstraintViolation } from "@/db/errors";
import {
  criterionIdSchema,
  type CriterionSpec,
  type CriterionValues,
  type EventId,
  type PlanId,
  type ReviewId,
  type SubmissionId,
  type TrackId,
  type UserId,
} from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { stableUuid } from "@/shared/server/stable-uuid";
import { isReviewComplete, isValidCriterionValue, normalizeCriterionValues, reviewWindow, weightedMean } from "../scoring";
import type { AssignmentInput, PlanWrite, ReviewInput, ReviewerAssignmentInput } from "../types";

/**
 * Evaluation's writes.
 *
 * Most are a single SQL statement, so a data-modifying CTE gets an all-or-nothing
 * guarantee over `neon-http`. Plan graph saves, reviewer replacement, and queue
 * replacement are the exceptions: they deliberately lock their plan in one
 * statement, then mutate from a fresh post-wait snapshot in a second statement
 * inside one transaction. The writes are also self-guarding —
 * `submitReview`'s assignment, status and window checks live in its `WHERE`, not
 * in a preceding read — so a round that closes mid-request cannot let one more
 * score through.
 */

const UNIQUE_NAME = "evaluation_plans_event_id_name_key";
const ASSIGNMENTS_LOCKED = "This round is no longer accepting review work. Reopen it or extend its close date before changing assignments.";

/**
 * Drizzle wraps the driver's error in one of its own and keeps the original as
 * `cause`, so the constraint name is a level or two down. Missing it turns
 * "you already have a Round 1" into a 500.
 */

/** Track scope is `null` for "every track"; an empty multi-select means the same thing. */
function normalizeTracks(trackIds: readonly TrackId[] | null): TrackId[] | null {
  return trackIds === null || trackIds.length === 0
    ? null
    : [...new Set(trackIds)].sort() as TrackId[];
}

/** One transaction is required wherever evaluation graph writers lock, then mutate. */
export type EvaluationTransaction = <T>(work: (tx: DbOrTx) => Promise<T>) => Promise<T>;

async function lockExistingEventPlan(tx: DbOrTx, eventId: EventId, planId: PlanId | null): Promise<void> {
  if (!planId) return;
  await tx.execute(sql`
    SELECT id FROM evaluation_plans
    WHERE id = ${planId} AND event_id = ${eventId}
    FOR UPDATE
  `);
}

async function lockWritableAssignmentPlan(tx: DbOrTx, eventId: EventId, planId: PlanId): Promise<void> {
  const result = await tx.execute<{ writable: boolean }>(sql`
    SELECT status = 'open' AND (closes_at IS NULL OR closes_at > clock_timestamp()) AS writable
    FROM evaluation_plans
    WHERE id = ${planId} AND event_id = ${eventId}
    FOR UPDATE
  `);
  const plan = (result.rows ?? [])[0];
  if (!plan) throw new AppError("NOT_FOUND", "Evaluation plan not found");
  if (!plan.writable) throw new AppError("CONFLICT", ASSIGNMENTS_LOCKED);
}

/**
 * The candidate-scope predicate, over an aliased `submissions s`: scorable, in
 * the round's tracks, and in the reviewer's. `NULL` on either array means
 * "every track". It is the same rule `inReviewerScope` states in TypeScript.
 */
function scopeSql(planTracks: SQL, reviewerTracks: SQL): SQL {
  return sql`s.status NOT IN ('draft', 'withdrawn')
    AND (${planTracks} IS NULL OR s.track_id = ANY(${planTracks}))
    AND (${reviewerTracks} IS NULL OR s.track_id = ANY(${reviewerTracks}))`;
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

type PersistedCriterion = {
  id: string;
  weight: number;
  kind: string;
  options: unknown;
  min_value: number | null;
  max_value: number | null;
};

type PersistedScoringShape = {
  scale_min: number;
  scale_max: number;
  has_reviews: boolean;
  criteria: PersistedCriterion[];
};

type ScoringInputs = { weight: number; kind: string; options: string; minValue: number | null; maxValue: number | null };

function numberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

/**
 * Everything about one criterion that feeds the arithmetic, as a comparable
 * value. A select option's *label* is presentation and may be reworded; its id
 * and its score are inputs — an id that disappears strands a stored answer, and
 * a score that moves silently re-values a verdict a reviewer already gave.
 * Options are keyed rather than ordered, because re-ordering the choices
 * changes nothing a mean depends on.
 */
function scoringInputs(
  criterion: { weight: unknown; kind: string; options: unknown; minValue: unknown; maxValue: unknown },
): ScoringInputs {
  const options = Array.isArray(criterion.options) ? criterion.options as Array<Record<string, unknown>> : [];
  return {
    weight: Number(criterion.weight),
    kind: criterion.kind,
    options: options
      .map((option) => `${String(option.id)}=${numberOrNull(option.score) ?? "—"}`)
      .sort()
      .join("|"),
    minValue: numberOrNull(criterion.minValue),
    maxValue: numberOrNull(criterion.maxValue),
  };
}

function sameScoringInputs(left: ScoringInputs, right: ScoringInputs): boolean {
  return left.weight === right.weight && left.kind === right.kind && left.options === right.options
    && left.minValue === right.minValue && left.maxValue === right.maxValue;
}

/**
 * A round that has been scored cannot have its arithmetic changed underneath
 * the scores. `overall_score` is computed at save time and never recomputed, so
 * anything that would re-value a stored verdict — the scale, the set of
 * criteria, a weight, a kind, a select option's score, a numeric bound — is a
 * new round's job, not an edit's.
 */
async function assertScoringShapeEditable(dbOrTx: DbOrTx, eventId: EventId, input: PlanWrite): Promise<void> {
  if (!input.planId) return;
  const result = await dbOrTx.execute<PersistedScoringShape>(sql`
    SELECT p.scale_min, p.scale_max,
      EXISTS (SELECT 1 FROM reviews r WHERE r.plan_id = p.id) AS has_reviews,
      COALESCE((
        SELECT json_agg(json_build_object('id', c.id, 'weight', c.weight::float8, 'kind', c.kind, 'options', c.options,
                                          'min_value', c.min_value::float8, 'max_value', c.max_value::float8) ORDER BY c.id)
        FROM evaluation_criteria c WHERE c.plan_id = p.id AND c.event_id = p.event_id
      ), '[]'::json) AS criteria
    FROM evaluation_plans p
    WHERE p.id = ${input.planId} AND p.event_id = ${eventId}
  `);
  const current = (result.rows ?? [])[0];
  if (!current?.has_reviews) return;

  const incoming = new Map<string, ScoringInputs>(input.criteria.flatMap((criterion) =>
    criterion.id ? [[String(criterion.id), scoringInputs(criterion)] as const] : []));
  const formulaIsUnchanged = Number(current.scale_min) === input.scaleMin
    && Number(current.scale_max) === input.scaleMax
    && incoming.size === input.criteria.length
    && incoming.size === current.criteria.length
    && current.criteria.every((criterion) => {
      const next = incoming.get(criterion.id);
      return next !== undefined && sameScoringInputs(next, scoringInputs({
        weight: criterion.weight,
        kind: criterion.kind,
        options: criterion.options,
        minValue: criterion.min_value,
        maxValue: criterion.max_value,
      }));
    });
  if (!formulaIsUnchanged) {
    throw new AppError(
      "CONFLICT",
      "This round already has reviews. Create a new round to change its scale, criteria, criterion kinds, weights, bounds, or option scores.",
    );
  }
}

/**
 * Typed criteria have to stay inside the round they belong to: a select option
 * worth 9 on a 1–5 scale would silently push a proposal's mean off the scale
 * every reviewer was told to use.
 */
function assertCriteriaWithinScale(input: PlanWrite): void {
  for (const criterion of input.criteria) {
    const label = `“${criterion.label}”`;
    if (criterion.kind === "numeric") {
      const min = criterion.minValue ?? input.scaleMin;
      const max = criterion.maxValue ?? input.scaleMax;
      if (min < input.scaleMin || max > input.scaleMax) {
        throw new AppError("VALIDATION", `${label} has bounds outside the round's ${input.scaleMin}–${input.scaleMax} scale`);
      }
      if (max <= min) throw new AppError("VALIDATION", `${label} needs a maximum above its minimum`);
      if (criterion.options.length > 0) throw new AppError("VALIDATION", `${label} is numeric, so it cannot carry options`);
    } else if (criterion.kind === "select") {
      if (criterion.options.length === 0) throw new AppError("VALIDATION", `${label} needs at least one option`);
      if (new Set(criterion.options.map((option) => option.id)).size !== criterion.options.length) {
        throw new AppError("VALIDATION", `${label} repeats an option id`);
      }
      for (const option of criterion.options) {
        if (option.score === null) continue;
        if (option.score < input.scaleMin || option.score > input.scaleMax) {
          throw new AppError("VALIDATION", `${label} scores “${option.label}” outside the round's ${input.scaleMin}–${input.scaleMax} scale`);
        }
      }
    } else if (criterion.options.length > 0) {
      throw new AppError("VALIDATION", `${label} collects text, so it cannot carry options`);
    }
  }
}

/**
 * Create or update a round together with its criteria, in one statement.
 * Criteria are matched by id rather than wiped and re-created: a review's
 * `criterion_scores` is keyed by criterion id, so re-creating them would orphan
 * every score already given under the old ids.
 *
 * A round's track scope is part of that save, and narrowing it takes the
 * submissions that fell out with it: the queue's authority is the assignment
 * row, so scope that is not enforced here is not enforced anywhere.
 */
async function savePlanInTransaction(
  dbOrTx: DbOrTx,
  eventId: EventId,
  input: PlanWrite,
  expectedUpdatedAt?: string,
): Promise<{ planId: PlanId }> {
  const trackIds = normalizeTracks(input.trackIds);
  await assertTracksInEvent(dbOrTx, eventId, trackIds);
  assertCriteriaWithinScale(input);

  const criteria = input.criteria.map((criterion, index) => ({
    // A stable create id must cover its child graph too. The editor normally
    // keeps criterion ids after the first response, but a retry after a lost
    // response still has null ids; deriving them prevents delete/reinsert from
    // changing the keys stored in review score JSON.
    id: criterion.id ?? (input.planId
      ? criterionIdSchema.parse(stableUuid(input.planId, `criterion:${index}`))
      : null),
    label: criterion.label,
    weight: criterion.weight,
    sort_order: index,
    kind: criterion.kind,
    required: criterion.required,
    options: criterion.options,
    min_value: criterion.minValue,
    max_value: criterion.maxValue,
  }));
  const keepIds = criteria.flatMap((criterion) => criterion.id ? [criterion.id] : []);
  // Ownership validation applies to ids the caller claimed already exist;
  // server-derived ids represent new criteria and therefore are not expected
  // to be present in the plan yet.
  const claimedIds = input.criteria.flatMap((criterion) => criterion.id ? [criterion.id] : []);
  // If this is an update or committed-create replay, acquire the plan lock in
  // its own statement. The upsert/descoped statement must start afterwards:
  // PostgreSQL keeps a stale statement snapshot when FOR UPDATE itself waits.
  await lockExistingEventPlan(dbOrTx, eventId, input.planId);
  await assertCriteriaInPlan(dbOrTx, eventId, input.planId, claimedIds);
  await assertScoringShapeEditable(dbOrTx, eventId, input);

  let rows: Array<{ id: string }>;
  try {
    const result = await dbOrTx.execute<{ id: string }>(sql`
      WITH saved AS (
        INSERT INTO evaluation_plans (id, event_id, name, round, scale_min, scale_max, status, track_ids, opens_at, closes_at, anonymize_authors, show_peer_scores)
        VALUES (COALESCE(${input.planId}::uuid, gen_random_uuid()), ${eventId}, ${input.name}, ${input.round},
                ${input.scaleMin}, ${input.scaleMax}, ${input.status}, ${uuidArraySql(trackIds)},
                ${input.opensAt}::timestamptz, ${input.closesAt}::timestamptz, ${input.anonymizeAuthors}, COALESCE(${input.showPeerScores ?? null}::boolean, false))
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name, round = EXCLUDED.round, scale_min = EXCLUDED.scale_min,
          scale_max = EXCLUDED.scale_max, status = EXCLUDED.status, track_ids = EXCLUDED.track_ids,
          opens_at = EXCLUDED.opens_at, closes_at = EXCLUDED.closes_at,
          anonymize_authors = EXCLUDED.anonymize_authors,
          -- Missing means an older browser, not "off". Preserve the stored
          -- setting atomically; an explicit false still disables sharing.
          show_peer_scores = COALESCE(${input.showPeerScores ?? null}::boolean, evaluation_plans.show_peer_scores),
          updated_at = now()
        WHERE evaluation_plans.event_id = ${eventId}
          AND (${expectedUpdatedAt ?? null}::timestamptz IS NULL OR date_trunc('milliseconds', evaluation_plans.updated_at) = date_trunc('milliseconds', ${expectedUpdatedAt ?? null}::timestamptz))
          -- Changing the round scope can delete live queue rows in descoped.
          -- Permit that only when the state being saved can still accept the
          -- resulting review work. Reopening/extending and rescoping together
          -- is safe; closing/rescoping together is not.
          AND (
            (
              (evaluation_plans.track_ids IS NULL AND EXCLUDED.track_ids IS NULL)
              OR (
                evaluation_plans.track_ids IS NOT NULL AND EXCLUDED.track_ids IS NOT NULL
                AND evaluation_plans.track_ids <@ EXCLUDED.track_ids
                AND evaluation_plans.track_ids @> EXCLUDED.track_ids
              )
            )
            OR (
              EXCLUDED.status = 'open'
              AND (EXCLUDED.closes_at IS NULL OR EXCLUDED.closes_at > clock_timestamp())
            )
          )
        RETURNING id
      ),
      dropped AS (
        DELETE FROM evaluation_criteria c USING saved
        WHERE c.plan_id = saved.id AND c.event_id = ${eventId}
          AND c.id <> ALL(${uuidArraySql(keepIds)})
      ),
      kept AS (
        INSERT INTO evaluation_criteria (id, event_id, plan_id, label, weight, sort_order, kind, required, options, min_value, max_value)
        SELECT COALESCE(incoming.id, gen_random_uuid()), ${eventId}, saved.id, incoming.label, incoming.weight, incoming.sort_order,
               incoming.kind, incoming.required, incoming.options, incoming.min_value, incoming.max_value
        FROM saved, jsonb_to_recordset(${JSON.stringify(criteria)}::jsonb)
          AS incoming(id uuid, label text, weight numeric, sort_order int, kind criterion_kind, required boolean,
                      options jsonb, min_value numeric, max_value numeric)
        ON CONFLICT (id) DO UPDATE SET
          label = EXCLUDED.label, weight = EXCLUDED.weight, sort_order = EXCLUDED.sort_order,
          kind = EXCLUDED.kind, required = EXCLUDED.required, options = EXCLUDED.options,
          min_value = EXCLUDED.min_value, max_value = EXCLUDED.max_value
        WHERE evaluation_criteria.event_id = EXCLUDED.event_id
          AND evaluation_criteria.plan_id = EXCLUDED.plan_id
      ),
      -- Narrowing the round narrows every queue it authorizes. The assignment
      -- row is what a reviewer may open and score (listReviewQueue and
      -- submitReview ask nothing about tracks), so a submission that has fallen
      -- out of the round's scope has to stop being an assignment here —
      -- otherwise an organizer who restricts a round to one track goes on
      -- showing the other track's proposals to the reviewers who had them,
      -- while listAssignableSubmissions and the plan's progress both move to
      -- the new scope. assignSubmissions already refuses to hand out
      -- out-of-scope work; this is the same rule applied to work already handed
      -- out.
      --
      -- The new scope is read from the parameter, not from evaluation_plans:
      -- every CTE here sees the same pre-statement snapshot, so the table still
      -- holds the *old* track_ids while this runs. Widening is deliberately not
      -- the mirror image — assignments are explicit, so a wider round adds
      -- candidates for the organizer to hand out, not queue rows.
      descoped AS (
        DELETE FROM review_assignments ra
        USING saved, submissions s
        WHERE ra.plan_id = saved.id AND ra.event_id = ${eventId}
          AND s.id = ra.submission_id AND s.event_id = ${eventId}
          -- A recusal is an audit record, not outstanding work: it survives a
          -- rescope exactly as it survives a reassignment.
          AND ra.status = 'assigned'
          -- COALESCE, not a bare NOT: an uncategorized submission compares NULL
          -- against a track filter, and NOT NULL is itself NULL, deleting
          -- nothing — while scopeSql counts it as out of a scoped round.
          AND NOT COALESCE(
            ${uuidArraySql(trackIds)} IS NULL OR s.track_id = ANY(${uuidArraySql(trackIds)}),
            false)
      )
      SELECT id FROM saved
    `);
    rows = result.rows ?? [];
  } catch (error) {
    if (isConstraintViolation(error, UNIQUE_NAME)) {
      throw new AppError("VALIDATION", `This event already has a round called “${input.name}”`, { fieldErrors: { name: "Already used by another round" } });
    }
    throw error;
  }

  const planId = rows[0]?.id;
  if (!planId) {
    // The insert wrote nothing, so the conflicting row is either somebody else's
    // event or a newer version of this plan. Say which.
    const existing = await dbOrTx.execute<{ event_id: string; version_matches: boolean; scope_locked: boolean }>(sql`
      SELECT event_id,
             (${expectedUpdatedAt ?? null}::timestamptz IS NULL
               OR date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', ${expectedUpdatedAt ?? null}::timestamptz)) AS version_matches,
             NOT (
               (track_ids IS NULL AND ${uuidArraySql(trackIds)} IS NULL)
               OR (
                 track_ids IS NOT NULL AND ${uuidArraySql(trackIds)} IS NOT NULL
                 AND track_ids <@ ${uuidArraySql(trackIds)}
                 AND track_ids @> ${uuidArraySql(trackIds)}
               )
             )
               AND NOT (
                 ${input.status}::plan_status = 'open'
                 AND (${input.closesAt}::timestamptz IS NULL OR ${input.closesAt}::timestamptz > clock_timestamp())
               ) AS scope_locked
      FROM evaluation_plans WHERE id = ${input.planId}
    `);
    const row = (existing.rows ?? [])[0];
    if (!row || row.event_id !== eventId) throw new AppError("NOT_FOUND", "Evaluation plan not found");
    if (row.scope_locked && row.version_matches) throw new AppError("CONFLICT", ASSIGNMENTS_LOCKED);
    throw new AppError("STALE_WRITE", "Someone else changed this round while you were editing it");
  }
  return { planId: planId as PlanId };
}

export function savePlanIn(
  inTransaction: EvaluationTransaction,
  eventId: EventId,
  input: PlanWrite,
  expectedUpdatedAt?: string,
): Promise<{ planId: PlanId }> {
  return inTransaction((tx) => savePlanInTransaction(tx, eventId, input, expectedUpdatedAt));
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
 * Replaces the plan's reviewer set wholesale, and materializes each reviewer's
 * queue from their track scope.
 *
 * Track scope is the *coarse* control and explicit assignment is the fine one,
 * so this only touches the queue of a reviewer who is new to the round or whose
 * scope actually changed: an organizer who curated somebody's queue by hand does
 * not lose it the next time they rename the round. When a scope does change, the
 * submissions that fell out of it are dropped and the ones that fell in are
 * added — which is what "I moved Ada onto AI Agents" plainly means.
 *
 * Reassignment changes what a reviewer sees next, never what they already
 * scored: removing a reviewer drops the routing and the queue and leaves every
 * `reviews` row standing, and a recusal is never pruned, because it is the
 * record of a decision rather than a piece of work.
 */
export async function assignReviewersIn(
  inTransaction: EvaluationTransaction,
  eventId: EventId,
  planId: PlanId,
  assignments: readonly ReviewerAssignmentInput[],
): Promise<void> {
  if (new Set(assignments.map((assignment) => assignment.userId)).size !== assignments.length) {
    throw new AppError("VALIDATION", "A reviewer can only be assigned once per evaluation plan");
  }
  const trackIds = [...new Set(assignments.flatMap((assignment) => assignment.trackIds ?? []))];
  const incoming = assignments.map((assignment) => ({
    user_id: assignment.userId,
    track_ids: normalizeTracks(assignment.trackIds),
  }));

  return inTransaction(async (tx) => {
    await assertTracksInEvent(tx, eventId, trackIds);
    // This has to be a separate statement. PostgreSQL does not replace a
    // statement's MVCC snapshot merely because FOR UPDATE waited; the mutation
    // below must begin after the lock is acquired to see the writer we waited on.
    await lockWritableAssignmentPlan(tx, eventId, planId);

    const result = await tx.execute<{ writable: boolean | null; matched: number }>(sql`
    WITH plan AS (
      SELECT status = 'open' AND (closes_at IS NULL OR closes_at > clock_timestamp()) AS writable
      FROM evaluation_plans WHERE id = ${planId} AND event_id = ${eventId}
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
      DELETE FROM reviewer_assignments a
      WHERE (SELECT writable FROM plan) AND (SELECT ok FROM valid) AND a.plan_id = ${planId}
        AND a.user_id NOT IN (SELECT user_id FROM members)
    ),
    -- Taking someone off the round takes their queue with them. The reviews
    -- they already wrote stay: this drops work, never verdicts.
    --
    -- status = 'assigned' for the same reason the pruned CTE below and
    -- assignSubmissionsIn's removed CTE carry it: a recusal is the record of a
    -- decision, not a piece of outstanding work, and removing a reviewer from a
    -- round is the operation most likely to *follow* one. Deleting it here
    -- would erase the reason and the timestamp that
    -- review_assignments_recusal_ck exists to keep honest. The row is already
    -- invisible to the queue, to progress (which reads reviewer_assignments)
    -- and to submitReview.
    unassigned AS (
      DELETE FROM review_assignments ra
      WHERE (SELECT writable FROM plan) AND (SELECT ok FROM valid) AND ra.plan_id = ${planId}
        AND ra.reviewer_user_id NOT IN (SELECT user_id FROM members)
        AND ra.status = 'assigned'
    ),
    -- Evaluated against the pre-statement snapshot, so it means "new to this
    -- round, or given a different scope than they had".
    changed AS (
      SELECT m.user_id, m.track_ids FROM members m
      WHERE NOT EXISTS (
        SELECT 1 FROM reviewer_assignments prior
        WHERE prior.plan_id = ${planId} AND prior.user_id = m.user_id
          AND prior.track_ids IS NOT DISTINCT FROM m.track_ids
      )
    ),
    pruned AS (
      DELETE FROM review_assignments ra
      USING evaluation_plans p, changed c, submissions s
      WHERE (SELECT writable FROM plan) AND (SELECT ok FROM valid) AND p.id = ${planId} AND p.event_id = ${eventId}
        AND ra.plan_id = ${planId} AND ra.event_id = ${eventId} AND ra.reviewer_user_id = c.user_id
        AND s.id = ra.submission_id AND s.event_id = ${eventId}
        AND ra.status = 'assigned'
        -- COALESCE, not a bare NOT: an uncategorized submission compares NULL
        -- against a track filter, and NOT NULL is itself NULL, deleting nothing.
        AND NOT COALESCE(${scopeSql(sql`p.track_ids`, sql`c.track_ids`)}, false)
    ),
    materialized AS (
      INSERT INTO review_assignments (event_id, plan_id, submission_id, reviewer_user_id)
      SELECT ${eventId}, ${planId}, s.id, c.user_id
      FROM evaluation_plans p, changed c, submissions s
      WHERE (SELECT writable FROM plan) AND (SELECT ok FROM valid)
        AND p.id = ${planId} AND p.event_id = ${eventId} AND s.event_id = ${eventId}
        AND ${scopeSql(sql`p.track_ids`, sql`c.track_ids`)}
      ON CONFLICT ON CONSTRAINT review_assignments_natural_key DO NOTHING
    ),
    upserted AS (
      INSERT INTO reviewer_assignments (event_id, plan_id, user_id, track_ids)
      SELECT ${eventId}, ${planId}, members.user_id, members.track_ids FROM members
      WHERE (SELECT writable FROM plan) AND (SELECT ok FROM valid)
      ON CONFLICT (plan_id, user_id) DO UPDATE SET track_ids = EXCLUDED.track_ids
    )
    SELECT (SELECT writable FROM plan) AS writable,
           (SELECT count(*)::int FROM members) AS matched
  `);

    const summary = (result.rows ?? [])[0];
    if (!summary?.writable) throw new AppError("CONFLICT", ASSIGNMENTS_LOCKED);
    if (Number(summary?.matched ?? 0) !== assignments.length) {
      throw new AppError("VALIDATION", "Every reviewer has to be a member of this event");
    }
  });
}

/**
 * Hand named submissions to named reviewers.
 *
 * `mode: "replace"` makes those reviewers' queues exactly the named
 * submissions and is the only way to take work back; `"add"` extends them.
 * Neither revives a recusal — a reviewer who declared a conflict is not handed
 * the same abstract again by a bulk action — and neither writes a row for a
 * reviewer who is not on the round or a submission that is not in it.
 */
export async function assignSubmissionsIn(
  inTransaction: EvaluationTransaction,
  eventId: EventId,
  input: AssignmentInput,
): Promise<{ assigned: number; removed: number }> {
  if (input.mode === "add" && input.submissionIds.length === 0) return { assigned: 0, removed: 0 };
  const reviewerIds = [...new Set(input.reviewerUserIds)];
  const submissionIds = [...new Set(input.submissionIds)];

  return inTransaction(async (tx) => {
    await lockWritableAssignmentPlan(tx, eventId, input.planId);

    const result = await tx.execute<{ writable: boolean | null; reviewers: number; submissions: number; assigned: number; removed: number }>(sql`
    WITH plan AS (
      SELECT status = 'open' AND (closes_at IS NULL OR closes_at > clock_timestamp()) AS writable
      FROM evaluation_plans WHERE id = ${input.planId} AND event_id = ${eventId}
    ),
    reviewers AS (
      SELECT a.user_id FROM reviewer_assignments a
      WHERE a.plan_id = ${input.planId} AND a.event_id = ${eventId}
        AND a.user_id = ANY(${uuidArraySql(reviewerIds)})
    ),
    -- A submission has to be real, scorable and inside the round's own track
    -- scope; an organizer cannot assign a draft or another round's work.
    targets AS (
      SELECT s.id FROM submissions s, evaluation_plans p
      WHERE p.id = ${input.planId} AND p.event_id = ${eventId} AND s.event_id = ${eventId}
        AND s.id = ANY(${uuidArraySql(submissionIds)})
        AND s.status NOT IN ('draft', 'withdrawn')
        AND (p.track_ids IS NULL OR s.track_id = ANY(p.track_ids))
    ),
    valid AS (
      SELECT (SELECT count(*) FROM reviewers) = ${reviewerIds.length}
        AND (SELECT count(*) FROM targets) = ${submissionIds.length} AS ok
    ),
    removed AS (
      DELETE FROM review_assignments ra
      WHERE (SELECT writable FROM plan) AND (SELECT ok FROM valid) AND ${input.mode === "replace"}
        AND ra.plan_id = ${input.planId} AND ra.event_id = ${eventId}
        AND ra.reviewer_user_id IN (SELECT user_id FROM reviewers)
        AND ra.submission_id NOT IN (SELECT id FROM targets)
        -- A recusal is an audit record. Replacing a queue must not erase the
        -- reason somebody stepped away from an abstract.
        AND ra.status = 'assigned'
      RETURNING ra.id
    ),
    added AS (
      INSERT INTO review_assignments (event_id, plan_id, submission_id, reviewer_user_id)
      SELECT ${eventId}, ${input.planId}, targets.id, reviewers.user_id
      FROM targets, reviewers
      WHERE (SELECT writable FROM plan) AND (SELECT ok FROM valid)
      ON CONFLICT ON CONSTRAINT review_assignments_natural_key DO NOTHING
      RETURNING id
    )
    SELECT (SELECT writable FROM plan) AS writable,
           (SELECT count(*)::int FROM reviewers) AS reviewers,
           (SELECT count(*)::int FROM targets) AS submissions,
           (SELECT count(*)::int FROM added) AS assigned,
           (SELECT count(*)::int FROM removed) AS removed
  `);

    const summary = (result.rows ?? [])[0];
    if (!summary?.writable) throw new AppError("CONFLICT", ASSIGNMENTS_LOCKED);
    if (Number(summary?.reviewers ?? 0) !== reviewerIds.length) {
      throw new AppError("VALIDATION", "Every reviewer has to be on this round before work can be assigned to them");
    }
    if (Number(summary?.submissions ?? 0) !== submissionIds.length) {
      throw new AppError("VALIDATION", "Every submission has to be in this round's scope and open for scoring");
    }
    return { assigned: Number(summary?.assigned ?? 0), removed: Number(summary?.removed ?? 0) };
  });
}

/**
 * A conflict of interest, recorded rather than deleted. The assignment stops
 * being outstanding work immediately, the reason and time stay attached to the
 * row, and reassigning the abstract to somebody else leaves this record intact
 * — which is the whole point of writing it down.
 */
export async function recuseAssignmentIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  planId: PlanId,
  submissionId: SubmissionId,
  reviewerUserId: UserId,
  reason: string,
): Promise<void> {
  const result = await dbOrTx.execute<{ id: string }>(sql`
    UPDATE review_assignments ra
    SET status = 'recused', recusal_reason = ${reason}, recused_at = now(), updated_at = now()
    WHERE ra.event_id = ${eventId} AND ra.plan_id = ${planId}
      AND ra.submission_id = ${submissionId} AND ra.reviewer_user_id = ${reviewerUserId}
      AND ra.status = 'assigned'
    RETURNING ra.id
  `);
  if ((result.rows ?? []).length > 0) return;

  const existing = await dbOrTx.execute<{ status: string }>(sql`
    SELECT status FROM review_assignments
    WHERE event_id = ${eventId} AND plan_id = ${planId}
      AND submission_id = ${submissionId} AND reviewer_user_id = ${reviewerUserId}
  `);
  const row = (existing.rows ?? [])[0];
  if (!row) throw new AppError("NOT_FOUND", "That submission is not assigned to this reviewer in this round");
  throw new AppError("CONFLICT", "This assignment is already recused");
}

type PlanShape = {
  scale_min: number; scale_max: number; status: "open" | "closed";
  opens_at: string | null; closes_at: string | null;
  criteria: Array<{ id: string; weight: number; kind: CriterionSpec["kind"]; required: boolean; options: unknown; minValue: number | null; maxValue: number | null }> | null;
};

function toSpecs(plan: PlanShape): CriterionSpec[] {
  return (plan.criteria ?? []).map((criterion) => ({
    id: criterion.id as CriterionSpec["id"],
    kind: criterion.kind,
    weight: Number(criterion.weight),
    required: criterion.required !== false,
    options: Array.isArray(criterion.options)
      ? (criterion.options as Array<Record<string, unknown>>).map((option) => ({
        id: String(option.id),
        label: String(option.label),
        score: option.score === null || option.score === undefined ? null : Number(option.score),
      }))
      : [],
    minValue: criterion.minValue === null || criterion.minValue === undefined ? null : Number(criterion.minValue),
    maxValue: criterion.maxValue === null || criterion.maxValue === undefined ? null : Number(criterion.maxValue),
  }));
}

/**
 * One reviewer's verdict on one submission in one round, upserted on
 * `(plan, submission, reviewer)`. The unique index plus `ON CONFLICT` is what
 * makes a double-submit an update instead of a second row — no "have they
 * already scored this?" pre-read, which is the version of this that races.
 *
 * A save is only *complete* when every required criterion holds a valid value;
 * an incomplete save still stores the reviewer's work but leaves `submitted_at`
 * and `overall_score` null, so it keeps its place in "still to score" and stays
 * out of `submission_ratings_v` rather than counting as a zero.
 */
export async function submitReviewIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  planId: PlanId,
  submissionId: SubmissionId,
  reviewerUserId: UserId,
  input: Omit<ReviewInput, "planId" | "submissionId">,
  now: Date = new Date(),
): Promise<{ reviewId: ReviewId; overallScore: number | null; complete: boolean }> {
  const planRows = await dbOrTx.execute<PlanShape>(sql`
    SELECT p.scale_min, p.scale_max, p.status, p.opens_at, p.closes_at,
      (SELECT json_agg(json_build_object('id', c.id, 'weight', c.weight::float8, 'kind', c.kind,
                                         'required', c.required, 'options', c.options,
                                         'minValue', c.min_value::float8, 'maxValue', c.max_value::float8))
       FROM evaluation_criteria c WHERE c.plan_id = p.id) AS criteria
    FROM evaluation_plans p WHERE p.id = ${planId} AND p.event_id = ${eventId}
  `);
  const plan = (planRows.rows ?? [])[0];
  if (!plan) throw new AppError("NOT_FOUND", "Evaluation plan not found");

  const window = reviewWindow({
    status: plan.status,
    opensAt: plan.opens_at ? new Date(plan.opens_at).toISOString() : null,
    closesAt: plan.closes_at ? new Date(plan.closes_at).toISOString() : null,
  }, now);
  if (!window.canSave) {
    throw new AppError("CONFLICT", window.state === "before_open"
      ? "This review round has not opened yet"
      : "This review round is closed, so scores can no longer change");
  }

  const specs = toSpecs(plan);
  const scale = { min: Number(plan.scale_min), max: Number(plan.scale_max) };
  const values: CriterionValues = normalizeCriterionValues(input.criterionScores);
  for (const [criterionId, value] of Object.entries(values)) {
    const spec = specs.find((candidate) => String(candidate.id) === criterionId);
    if (!spec) throw new AppError("VALIDATION", "That criterion is not part of this round");
    if (!isValidCriterionValue(spec, value, scale)) {
      throw new AppError("VALIDATION", spec.kind === "numeric"
        ? `Every numeric criterion has to be between ${spec.minValue ?? scale.min} and ${spec.maxValue ?? scale.max}`
        : spec.kind === "select"
          ? "That option is not one of this criterion's choices"
          : "That criterion expects written feedback");
    }
  }

  // With criteria the overall score is derived — the client may preview it, but
  // the number that is stored is the one the server computed.
  let overall: number | null;
  if (specs.length > 0) {
    overall = weightedMean(specs, values);
  } else {
    overall = input.overallScore;
    if (overall !== null && (!Number.isFinite(overall) || overall < scale.min || overall > scale.max)) {
      throw new AppError("VALIDATION", `The score has to be between ${scale.min} and ${scale.max}`);
    }
  }
  const complete = isReviewComplete(specs, values, specs.length > 0 ? overall : input.overallScore, scale);
  // A review that is not finished has no rating to contribute, whatever
  // arithmetic the partial values would allow.
  if (!complete) overall = null;

  const result = await dbOrTx.execute<{ id: string }>(sql`
    INSERT INTO reviews (event_id, plan_id, submission_id, reviewer_user_id, overall_score, criterion_scores, comment, submitted_at)
    SELECT ${eventId}, p.id, s.id, ${reviewerUserId}, ${overall}, ${JSON.stringify(values)}::jsonb, ${input.comment},
           CASE WHEN ${complete} THEN now() ELSE NULL END
    FROM evaluation_plans p
    JOIN submissions s ON s.event_id = p.event_id AND s.id = ${submissionId}
    JOIN review_assignments ra ON ra.plan_id = p.id AND ra.event_id = p.event_id
      AND ra.submission_id = s.id AND ra.reviewer_user_id = ${reviewerUserId} AND ra.status = 'assigned'
    WHERE p.id = ${planId} AND p.event_id = ${eventId} AND p.status = 'open'
      -- The window is re-checked inside the write, against the same instant the
      -- pre-check used, so a round that closes between the two cannot let one
      -- more score through and a test can pin the boundary exactly.
      AND (p.opens_at IS NULL OR p.opens_at <= ${now.toISOString()}::timestamptz)
      AND (p.closes_at IS NULL OR p.closes_at > ${now.toISOString()}::timestamptz)
      AND s.status NOT IN ('draft', 'withdrawn')
    ON CONFLICT (plan_id, submission_id, reviewer_user_id) DO UPDATE SET
      overall_score = EXCLUDED.overall_score, criterion_scores = EXCLUDED.criterion_scores,
      comment = EXCLUDED.comment,
      -- A retried save is not a second verdict. Keep its original completion
      -- time so the database audit trigger can recognize an exact no-op;
      -- changing any answer, score, comment, or completion state gets a fresh
      -- time and therefore a new revision.
      submitted_at = CASE
        WHEN reviews.overall_score IS NOT DISTINCT FROM EXCLUDED.overall_score
          AND reviews.criterion_scores IS NOT DISTINCT FROM EXCLUDED.criterion_scores
          AND reviews.comment IS NOT DISTINCT FROM EXCLUDED.comment
          AND (reviews.submitted_at IS NULL) = (EXCLUDED.submitted_at IS NULL)
        THEN reviews.submitted_at
        ELSE EXCLUDED.submitted_at
      END,
      updated_at = now()
    RETURNING id
  `);

  const reviewId = (result.rows ?? [])[0]?.id;
  if (!reviewId) throw await scoringRefusal(dbOrTx, eventId, planId, submissionId, reviewerUserId);
  return { reviewId: reviewId as ReviewId, overallScore: overall, complete };
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
    plan_status: string | null; submission_status: string | null; assignment_status: string | null;
  }>(sql`
    SELECT p.status AS plan_status, s.status AS submission_status, ra.status AS assignment_status
    FROM evaluation_plans p
    LEFT JOIN submissions s ON s.event_id = p.event_id AND s.id = ${submissionId}
    LEFT JOIN review_assignments ra ON ra.plan_id = p.id AND ra.event_id = p.event_id
      AND ra.submission_id = ${submissionId} AND ra.reviewer_user_id = ${reviewerUserId}
    WHERE p.id = ${planId} AND p.event_id = ${eventId}
  `);
  const row = (result.rows ?? [])[0];
  if (!row) return new AppError("NOT_FOUND", "Evaluation plan not found");
  if (row.plan_status !== "open") return new AppError("CONFLICT", "This round is closed");
  if (!row.submission_status) return new AppError("NOT_FOUND", "Submission not found");
  if (row.submission_status === "draft" || row.submission_status === "withdrawn") {
    return new AppError("CONFLICT", `A ${row.submission_status} submission cannot be scored`);
  }
  if (row.assignment_status === "recused") return new AppError("CONFLICT", "You recused yourself from this submission");
  if (!row.assignment_status) return new AppError("FORBIDDEN", "That submission is not assigned to you in this round");
  return new AppError("INTERNAL", "The review could not be saved");
}

export const savePlan = (eventId: EventId, input: PlanWrite, expectedUpdatedAt?: string) =>
  savePlanIn((work) => withTx(work), eventId, input, expectedUpdatedAt);
export const deletePlan = (eventId: EventId, planId: PlanId) => deletePlanIn(db, eventId, planId);
export const assignReviewers = (eventId: EventId, planId: PlanId, assignments: readonly ReviewerAssignmentInput[]) =>
  assignReviewersIn((work) => withTx(work), eventId, planId, assignments);
export const assignSubmissions = (eventId: EventId, input: AssignmentInput) =>
  assignSubmissionsIn((work) => withTx(work), eventId, input);
export const recuseAssignment = (
  eventId: EventId,
  planId: PlanId,
  submissionId: SubmissionId,
  reviewerUserId: UserId,
  reason: string,
) => recuseAssignmentIn(db, eventId, planId, submissionId, reviewerUserId, reason);
export const submitReview = (
  eventId: EventId,
  planId: PlanId,
  submissionId: SubmissionId,
  reviewerUserId: UserId,
  input: Omit<ReviewInput, "planId" | "submissionId">,
) => submitReviewIn(db, eventId, planId, submissionId, reviewerUserId, input);
