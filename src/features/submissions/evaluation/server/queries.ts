import { sql, type SQL } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { criterionIdSchema, type CriterionSpec, type CriterionValue, type EventId, type PlanId, type SubmissionId, type UserId } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { normalizeCriterionValues, reviewWindow } from "../scoring";
import type {
  AssignableSubmission,
  CriterionDTO,
  PlanDTO,
  ReviewHistoryEntry,
  ReviewQueueDTO,
  ReviewQueueRow,
  ReviewerProgress,
} from "../types";

/**
 * Evaluation's reads. Every one is event-scoped, and every aggregate is scoped
 * to a single plan: two rounds over the same abstract are two independent
 * verdicts, and averaging them together would report a number no reviewer ever
 * gave.
 *
 * M50 moves the queue's authority from track scope to `review_assignments`.
 * Track scope still decides who is a plausible *candidate*; the assignment row
 * is what a reviewer may open, and it is re-checked on every read and write.
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
 * The candidate-scope rule in SQL — the same predicate as `inReviewerScope`,
 * expressed over the columns. It is what an organizer's bulk-assign dialog
 * filters by; it is no longer what authorizes a read.
 */
function scopeClause(planTracks: SQL, assignmentTracks: SQL): SQL {
  return sql`s.status NOT IN ('draft', 'withdrawn')
    AND (${planTracks} IS NULL OR s.track_id = ANY(${planTracks}))
    AND (${assignmentTracks} IS NULL OR s.track_id = ANY(${assignmentTracks}))`;
}

/** A live assignment: recusals stay on the row for the audit trail but stop being work. */
const LIVE = sql`ra.status = 'assigned'`;

type PlanRow = {
  id: string; name: string; round: number; scale_min: number; scale_max: number;
  status: PlanDTO["status"]; track_ids: string[] | null;
  opens_at: string | null; closes_at: string | null; anonymize_authors: boolean; show_peer_scores: boolean;
  criteria: Array<Record<string, unknown>> | null; reviewers: Array<Record<string, unknown>> | null;
  scored: number; total: number; updated_at: string;
};

function toCriterion(raw: Record<string, unknown>): CriterionDTO {
  return {
    id: raw.id as CriterionDTO["id"],
    label: String(raw.label),
    weight: Number(raw.weight),
    sortOrder: Number(raw.sortOrder),
    kind: (raw.kind ?? "numeric") as CriterionDTO["kind"],
    required: raw.required !== false,
    options: Array.isArray(raw.options)
      ? (raw.options as Array<Record<string, unknown>>).map((option) => ({
        id: String(option.id),
        label: String(option.label),
        score: option.score === null || option.score === undefined ? null : Number(option.score),
      }))
      : [],
    minValue: raw.minValue === null || raw.minValue === undefined ? null : Number(raw.minValue),
    maxValue: raw.maxValue === null || raw.maxValue === undefined ? null : Number(raw.maxValue),
  };
}

function toReviewer(raw: Record<string, unknown>): ReviewerProgress {
  const assigned = Number(raw.assigned ?? 0);
  const completed = Number(raw.completed ?? 0);
  return {
    userId: raw.userId as ReviewerProgress["userId"],
    name: String(raw.name ?? ""),
    email: String(raw.email ?? ""),
    trackIds: (raw.trackIds ?? null) as ReviewerProgress["trackIds"],
    assigned,
    completed,
    recused: Number(raw.recused ?? 0),
    outstanding: Math.max(assigned - completed, 0),
    scored: completed,
  };
}

function toPlan(row: PlanRow): PlanDTO {
  return {
    id: row.id as PlanId,
    name: row.name,
    round: Number(row.round),
    scaleMin: Number(row.scale_min),
    scaleMax: Number(row.scale_max),
    status: row.status,
    trackIds: (row.track_ids ?? null) as PlanDTO["trackIds"],
    opensAt: row.opens_at ? new Date(row.opens_at).toISOString() : null,
    closesAt: row.closes_at ? new Date(row.closes_at).toISOString() : null,
    anonymizeAuthors: row.anonymize_authors === true,
    showPeerScores: row.show_peer_scores === true,
    criteria: (row.criteria ?? []).map(toCriterion),
    reviewers: (row.reviewers ?? []).map(toReviewer),
    progress: { scored: Number(row.scored), total: Number(row.total) },
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

async function selectPlans(dbOrTx: DbOrTx, eventId: EventId, only?: SQL): Promise<PlanDTO[]> {
  const result = await dbOrTx.execute<PlanRow>(sql`
    SELECT p.id, p.name, p.round, p.scale_min, p.scale_max, p.status, p.track_ids, p.updated_at,
      p.opens_at, p.closes_at, p.anonymize_authors, p.show_peer_scores,
      COALESCE((
        SELECT json_agg(json_build_object(
                 'id', c.id, 'label', c.label, 'weight', c.weight::float8, 'sortOrder', c.sort_order,
                 'kind', c.kind, 'required', c.required, 'options', c.options,
                 'minValue', c.min_value::float8, 'maxValue', c.max_value::float8)
                        ORDER BY c.sort_order, c.label)
        FROM evaluation_criteria c WHERE c.plan_id = p.id AND c.event_id = p.event_id
      ), '[]'::json) AS criteria,
      COALESCE((
        SELECT json_agg(json_build_object(
                 'userId', a.user_id, 'name', u.name, 'email', u.email, 'trackIds', a.track_ids,
                 -- Progress is per reviewer over *their own* assigned work, not
                 -- over the whole round: a reviewer given six abstracts has
                 -- finished when those six are done.
                 'assigned', (SELECT count(*) FROM review_assignments ra
                              WHERE ra.plan_id = p.id AND ra.reviewer_user_id = a.user_id AND ${LIVE}),
                 'completed', (SELECT count(*) FROM review_assignments ra
                               JOIN reviews r ON r.plan_id = ra.plan_id AND r.submission_id = ra.submission_id
                                 AND r.reviewer_user_id = ra.reviewer_user_id AND r.submitted_at IS NOT NULL
                               WHERE ra.plan_id = p.id AND ra.reviewer_user_id = a.user_id AND ${LIVE}),
                 'recused', (SELECT count(*) FROM review_assignments ra
                             WHERE ra.plan_id = p.id AND ra.reviewer_user_id = a.user_id AND ra.status = 'recused')
               ) ORDER BY lower(u.name), u.email)
        FROM reviewer_assignments a
        JOIN users u ON u.id = a.user_id
        WHERE a.plan_id = p.id AND a.event_id = p.event_id
      ), '[]'::json) AS reviewers,
      -- Plan-level progress stays what M19 meant by it: how much of the round's
      -- own scope has a verdict. Completion is submitted_at, so a finished
      -- review of a text-only criterion counts even though it has no number.
      (SELECT count(*)::int FROM submissions s
       WHERE s.event_id = p.event_id AND ${scopeClause(sql`p.track_ids`, sql`NULL::uuid[]`)}) AS total,
      (SELECT count(DISTINCT r.submission_id)::int FROM reviews r
       JOIN submissions s ON s.id = r.submission_id AND s.event_id = r.event_id
       WHERE r.plan_id = p.id AND r.event_id = p.event_id AND r.submitted_at IS NOT NULL
         AND ${scopeClause(sql`p.track_ids`, sql`NULL::uuid[]`)}) AS scored
    FROM evaluation_plans p
    WHERE p.event_id = ${eventId} ${only ? sql`AND ${only}` : sql``}
    ORDER BY p.round, lower(p.name)
  `);
  return (result.rows ?? []).map(toPlan);
}

export function listPlansIn(dbOrTx: DbOrTx, eventId: EventId): Promise<PlanDTO[]> {
  return selectPlans(dbOrTx, eventId);
}

/**
 * A reviewer's copy of a round: its governance and its scorecard, and none of
 * the committee.
 *
 * `PlanDTO.reviewers` is organizer material — every colleague's name, address
 * and completion count. The reviewer's own screens never render it, so shipping
 * it to them was only ever a payload nobody looked at, and in a blind round
 * "who else is reading this" is precisely the kind of thing that should not
 * travel further than it has to. Redaction happens here, while the DTO is being
 * built, for the same reason blindness does: a route cannot forget to do what it
 * was never handed.
 */
export function forReviewer(plan: PlanDTO): PlanDTO {
  return { ...plan, reviewers: [] };
}

/** The rounds a reviewer is on, as their own round-switcher lists them. */
export async function listReviewerPlansIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  reviewerUserId: UserId,
): Promise<PlanDTO[]> {
  const plans = await selectPlans(dbOrTx, eventId, sql`EXISTS (
    SELECT 1 FROM reviewer_assignments a
    WHERE a.plan_id = p.id AND a.event_id = p.event_id AND a.user_id = ${reviewerUserId}
  )`);
  return plans.map(forReviewer);
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

/** The specs `submitReview` grades against — the DTO's criteria, minus presentation. */
export function criterionSpecs(plan: PlanDTO): CriterionSpec[] {
  return plan.criteria.map((criterion) => ({
    id: criterion.id,
    kind: criterion.kind,
    weight: criterion.weight,
    required: criterion.required,
    options: criterion.options,
    minValue: criterion.minValue,
    maxValue: criterion.maxValue,
  }));
}

async function getReviewerDefaultPlanIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  reviewerUserId: UserId,
): Promise<PlanDTO | null> {
  const [plan] = await selectPlans(dbOrTx, eventId, sql`p.id = (
    SELECT assigned.id FROM evaluation_plans assigned
    JOIN reviewer_assignments a ON a.plan_id = assigned.id AND a.event_id = assigned.event_id
    WHERE assigned.event_id = ${eventId} AND a.user_id = ${reviewerUserId}
    ORDER BY (assigned.status = 'open') DESC, assigned.round ASC, assigned.created_at ASC
    LIMIT 1
  )`);
  return plan ?? null;
}

type QueueRow = {
  submission_id: string; code: number; title: string; track_id: string | null; track_name: string | null;
  my_score: string | null; my_criterion_scores: unknown; my_comment: string | null;
  scored_at: string | null; avg_rating: number | null; n_scores: number | null;
  assignment_status: ReviewQueueRow["assignmentStatus"]; recusal_reason: string | null;
};

/**
 * What one reviewer has to work through in one round.
 *
 * The assignment row is the gate: a member with no assignment gets an empty
 * queue rather than the whole event, and the same join reappears inside
 * `submitReview` so nobody can score past it by editing a request body.
 *
 * Before the round opens the queue is deliberately empty rather than
 * title-only. A proposal's title is content, and "cannot read item content
 * before the window" has to mean the payload, not the styling.
 */
export async function listReviewQueueIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  reviewerUserId: UserId,
  planId: PlanId | null,
  now: Date = new Date(),
): Promise<ReviewQueueDTO> {
  const found = planId
    ? await getPlanIn(dbOrTx, eventId, planId)
    : await getReviewerDefaultPlanIn(dbOrTx, eventId, reviewerUserId);
  if (!found) return { plan: null, rows: [], progress: { scored: 0, total: 0 }, window: null };
  // The reviewer's copy from here down: the committee roster is the
  // organizer's, and this DTO goes straight to a reviewer's browser.
  const plan = forReviewer(found);

  const window = reviewWindow(plan, now);
  if (!window.canRead) return { plan, rows: [], progress: { scored: 0, total: 0 }, window };

  const result = await dbOrTx.execute<QueueRow>(sql`
    SELECT s.id AS submission_id, s.code, s.title, s.track_id, t.name AS track_name,
           r.overall_score AS my_score, r.criterion_scores AS my_criterion_scores,
           r.comment AS my_comment, r.submitted_at AS scored_at,
           CASE WHEN p.show_peer_scores THEN v.rating END AS avg_rating,
           CASE WHEN p.show_peer_scores THEN COALESCE(v.n_scores, 0) END AS n_scores,
           ra.status AS assignment_status, ra.recusal_reason
    FROM review_assignments ra
    JOIN evaluation_plans p ON p.id = ra.plan_id AND p.event_id = ra.event_id
    JOIN submissions s ON s.id = ra.submission_id AND s.event_id = ra.event_id
    LEFT JOIN tracks t ON t.id = s.track_id AND t.event_id = s.event_id
    LEFT JOIN reviews r ON r.plan_id = ra.plan_id AND r.submission_id = ra.submission_id
      AND r.reviewer_user_id = ra.reviewer_user_id
    LEFT JOIN submission_ratings_v v ON v.plan_id = p.id AND v.submission_id = s.id AND v.event_id = s.event_id
    WHERE ra.plan_id = ${plan.id} AND ra.event_id = ${eventId} AND ra.reviewer_user_id = ${reviewerUserId}
      AND ${LIVE}
      AND s.status NOT IN ('draft', 'withdrawn')
    -- Unfinished first: the queue is a worklist, so what still needs a verdict
    -- belongs at the top of it.
    ORDER BY (r.submitted_at IS NOT NULL), s.code
  `);

  const rows = (result.rows ?? []).map((row): ReviewQueueRow => {
    const values = normalizeCriterionValues(row.my_criterion_scores);
    return {
      submissionId: row.submission_id as SubmissionId,
      code: Number(row.code),
      title: row.title,
      trackId: row.track_id as ReviewQueueRow["trackId"],
      trackName: row.track_name,
      myScore: row.my_score === null ? null : Number(row.my_score),
      myCriterionScores: Object.fromEntries(Object.entries(values)
        .flatMap(([id, value]) => value?.kind === "numeric" ? [[id, value.value] as const] : [])),
      myCriterionValues: values,
      myComment: row.my_comment,
      scoredAt: row.scored_at ? new Date(row.scored_at).toISOString() : null,
      avgRating: row.avg_rating === null ? null : Number(row.avg_rating),
      nScores: row.n_scores === null ? null : Number(row.n_scores),
      assignmentStatus: row.assignment_status,
      recusalReason: row.recusal_reason,
    };
  });

  return {
    plan,
    rows,
    // Completion is `submitted_at`, not "has a number": a finished review of a
    // round with only text criteria still counts as done.
    progress: { scored: rows.filter((row) => row.scoredAt !== null).length, total: rows.length },
    window,
  };
}

/**
 * Whether this reviewer may open this submission in this round, as one
 * statement. Refusal is deliberately shaped like "not routed to you" rather
 * than "does not exist here": the reviewer needs to know it is not their work,
 * and does not need to learn anything else about it.
 */
export async function assertReviewerCanReadSubmissionIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  planId: PlanId,
  submissionId: SubmissionId,
  reviewerUserId: UserId,
  now: Date = new Date(),
): Promise<void> {
  const result = await dbOrTx.execute<{
    allowed: boolean; status: PlanDTO["status"]; opens_at: string | null; closes_at: string | null;
  }>(sql`
    SELECT (ra.id IS NOT NULL) AS allowed, p.status, p.opens_at, p.closes_at
    FROM evaluation_plans p
    LEFT JOIN review_assignments ra
      ON ra.plan_id = p.id AND ra.event_id = p.event_id
      AND ra.submission_id = ${submissionId} AND ra.reviewer_user_id = ${reviewerUserId}
      AND ra.status = 'assigned'
    WHERE p.id = ${planId} AND p.event_id = ${eventId}
    LIMIT 1
  `);
  const row = (result.rows ?? [])[0];
  if (!row?.allowed) {
    throw new AppError("FORBIDDEN", "That submission is not assigned to you in this review round");
  }
  const window = reviewWindow({
    status: row.status,
    opensAt: row.opens_at ? new Date(row.opens_at).toISOString() : null,
    closesAt: row.closes_at ? new Date(row.closes_at).toISOString() : null,
  }, now);
  if (!window.canRead) {
    throw new AppError("FORBIDDEN", "This review round has not opened yet");
  }
}

/**
 * Who an organizer may put on a round: this event's members, reviewers and
 * organizers alike (an organizer scoring their own event is normal). The plans
 * page renders it as the assignment picker.
 */
export async function listEventMembersIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
): Promise<Array<{ userId: UserId; name: string; email: string; role: string }>> {
  const result = await dbOrTx.execute<{ user_id: string; name: string; email: string; role: string }>(sql`
    SELECT m.user_id, u.name, u.email, m.role
    FROM event_members m JOIN users u ON u.id = m.user_id
    WHERE m.event_id = ${eventId}
    ORDER BY lower(u.name), u.email
  `);
  return (result.rows ?? []).map((row) => ({
    userId: row.user_id as UserId,
    name: row.name,
    email: row.email,
    role: row.role,
  }));
}

/**
 * The submissions an organizer can hand out in this round, with who already has
 * each. Track scope narrows the candidates — that is what it is for now — while
 * the assignment rows below it are the authority.
 */
export async function listAssignableSubmissionsIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  planId: PlanId,
): Promise<AssignableSubmission[]> {
  const result = await dbOrTx.execute<{
    submission_id: string; code: number; title: string; track_id: string | null; track_name: string | null;
    assigned_to: string[] | null;
  }>(sql`
    SELECT s.id AS submission_id, s.code, s.title, s.track_id, t.name AS track_name,
      COALESCE((
        SELECT array_agg(ra.reviewer_user_id ORDER BY ra.reviewer_user_id)
        FROM review_assignments ra
        WHERE ra.plan_id = p.id AND ra.submission_id = s.id AND ra.status = 'assigned'
      ), ARRAY[]::uuid[]) AS assigned_to
    FROM evaluation_plans p
    JOIN submissions s ON s.event_id = p.event_id
    LEFT JOIN tracks t ON t.id = s.track_id AND t.event_id = s.event_id
    WHERE p.id = ${planId} AND p.event_id = ${eventId}
      AND ${scopeClause(sql`p.track_ids`, sql`NULL::uuid[]`)}
    ORDER BY s.code
  `);
  return (result.rows ?? []).map((row) => ({
    submissionId: row.submission_id as SubmissionId,
    code: Number(row.code),
    title: row.title,
    trackId: row.track_id as AssignableSubmission["trackId"],
    trackName: row.track_name,
    assignedTo: (row.assigned_to ?? []) as UserId[],
  }));
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

type ReviewRevisionRow = {
  id: string;
  review_id: string;
  plan_id: string;
  plan_name: string;
  reviewer_user_id: string;
  reviewer_name: string;
  reviewer_email: string;
  revision: number;
  overall_score: string | null;
  criterion_scores: unknown;
  criteria_snapshot: unknown;
  comment: string | null;
  submitted_at: string | null;
  recorded_at: string;
};

type RevisionCriterion = {
  id: string;
  label: string;
  options: Array<{ id: string; label: string }>;
};

function revisionCriteria(raw: unknown): RevisionCriterion[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value): RevisionCriterion[] => {
    if (value === null || typeof value !== "object") return [];
    const candidate = value as { id?: unknown; label?: unknown; options?: unknown };
    if (typeof candidate.id !== "string" || typeof candidate.label !== "string") return [];
    const options = Array.isArray(candidate.options)
      ? candidate.options.flatMap((option): RevisionCriterion["options"] => {
        if (option === null || typeof option !== "object") return [];
        const item = option as { id?: unknown; label?: unknown };
        return typeof item.id === "string" && typeof item.label === "string"
          ? [{ id: item.id, label: item.label }]
          : [];
      })
      : [];
    return [{ id: candidate.id, label: candidate.label, options }];
  });
}

function reviewAnswerText(value: CriterionValue, criterion: RevisionCriterion): string {
  if (value.kind === "numeric") return String(value.value);
  if (value.kind === "text") return value.value;
  return criterion.options.find((option) => option.id === value.optionId)?.label ?? value.optionId;
}

/**
 * Organizer-only callers use this attributed history to explain how a proposal's
 * verdict changed. Labels and select choices come from the revision snapshot,
 * not today's mutable plan.
 */
export async function listReviewHistoryIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  submissionId: SubmissionId,
): Promise<ReviewHistoryEntry[]> {
  const result = await dbOrTx.execute<ReviewRevisionRow>(sql`
    SELECT rr.id, rr.review_id, rr.plan_id, p.name AS plan_name,
      rr.reviewer_user_id, u.name AS reviewer_name, u.email AS reviewer_email,
      rr.revision, rr.overall_score, rr.criterion_scores, rr.criteria_snapshot,
      rr.comment, rr.submitted_at, rr.recorded_at
    FROM review_revisions rr
    JOIN evaluation_plans p ON p.id = rr.plan_id AND p.event_id = rr.event_id
    JOIN users u ON u.id = rr.reviewer_user_id
    WHERE rr.event_id = ${eventId} AND rr.submission_id = ${submissionId}
    ORDER BY rr.recorded_at DESC, rr.revision DESC, rr.id
  `);

  return (result.rows ?? []).map((row) => {
    const values = normalizeCriterionValues(row.criterion_scores);
    const criteria = revisionCriteria(row.criteria_snapshot);
    return {
      id: row.id,
      reviewId: row.review_id,
      planId: row.plan_id as PlanId,
      planName: row.plan_name,
      reviewerUserId: row.reviewer_user_id as UserId,
      reviewerName: row.reviewer_name,
      reviewerEmail: row.reviewer_email,
      revision: Number(row.revision),
      overallScore: row.overall_score === null ? null : Number(row.overall_score),
      answers: criteria.flatMap((criterion) => {
        const criterionId = criterionIdSchema.safeParse(criterion.id);
        if (!criterionId.success) return [];
        const value = values[criterionId.data];
        return value ? [{ criterionId: criterion.id, label: criterion.label, value: reviewAnswerText(value, criterion) }] : [];
      }),
      comment: row.comment,
      complete: row.submitted_at !== null,
      recordedAt: new Date(row.recorded_at).toISOString(),
    };
  });
}

export const listPlans = (eventId: EventId) => listPlansIn(db, eventId);
export const listReviewerPlans = (eventId: EventId, reviewerUserId: UserId) =>
  listReviewerPlansIn(db, eventId, reviewerUserId);
export const getPlan = (eventId: EventId, planId: PlanId) => getPlanIn(db, eventId, planId);
export const getActivePlan = (eventId: EventId) => getActivePlanIn(db, eventId);
export const listReviewQueue = (eventId: EventId, reviewerUserId: UserId, planId: PlanId | null) =>
  listReviewQueueIn(db, eventId, reviewerUserId, planId);
export const assertReviewerCanReadSubmission = (
  eventId: EventId,
  planId: PlanId,
  submissionId: SubmissionId,
  reviewerUserId: UserId,
) => assertReviewerCanReadSubmissionIn(db, eventId, planId, submissionId, reviewerUserId);
export const getRatings = (eventId: EventId, planId: PlanId) => getRatingsIn(db, eventId, planId);
export const listReviewHistory = (eventId: EventId, submissionId: SubmissionId) =>
  listReviewHistoryIn(db, eventId, submissionId);
export const listEventMembers = (eventId: EventId) => listEventMembersIn(db, eventId);
export const listAssignableSubmissions = (eventId: EventId, planId: PlanId) =>
  listAssignableSubmissionsIn(db, eventId, planId);
