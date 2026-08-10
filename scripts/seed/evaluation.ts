import { sql } from "drizzle-orm";
import {
  assignReviewersIn,
  assignSubmissionsIn,
  planInputSchema,
  recuseAssignmentIn,
  savePlanIn,
  submitReviewIn,
} from "@/features/submissions";
import type { PlanId, SubmissionId, TrackId, UserId } from "@/shared/contracts";
import type { SeedCtx } from "./lib/helpers";

/**
 * Owned by M19 (WS-C).
 *
 * One open round, two criteria, both seeded members assigned, and a *partial*
 * set of scores. The partiality is the point: the Rating column has to show
 * numbers, an em dash, and nulls sorting last on the same screen, or nobody
 * finds out which of the three is broken.
 *
 * Every row is written through the real server functions — `savePlanIn`,
 * `assignReviewersIn`, `submitReviewIn` — so the seed exercises the scope rule
 * and the weighted mean rather than a private copy of them. An existing seeded
 * round is left completely alone, so a non-wipe rerun cannot reopen it, reset
 * its criteria or assignments, or overwrite a walkthrough verdict.
 */

const CRITERIA = [
  { key: "relevance", label: "Relevance", weight: 2 },
  { key: "quality", label: "Quality", weight: 1 },
];

/** The reviewer sees two of the four tracks — the demo's routing evidence. */
const REVIEWER_TRACKS = ["agents", "platforms"];

/** Deterministic and uneven, so the Rating column is a spread rather than a row of 4s. */
const REVIEWER_SCORES = [
  { relevance: 5, quality: 4 },
  { relevance: 4, quality: 5 },
  { relevance: 3, quality: 3 },
  { relevance: 5, quality: 5 },
  { relevance: 2, quality: 3 },
  { relevance: 4, quality: 2 },
];
const ORGANIZER_SCORES = [{ relevance: 3, quality: 4 }, { relevance: 5, quality: 3 }];

async function userIdFor(ctx: SeedCtx, email: string): Promise<UserId | null> {
  const [row] = (await ctx.tx.execute<{ id: string }>(sql`
    SELECT u.id FROM users u
    JOIN event_members m ON m.user_id = u.id AND m.event_id = ${ctx.eventId}
    WHERE u.email = ${email}
  `)).rows ?? [];
  return (row?.id as UserId) ?? null;
}

export async function seedEvaluation(ctx: SeedCtx): Promise<void> {
  const { tx, eventId } = ctx;

  const reviewerId = await userIdFor(ctx, "reviewer@openboard.dev");
  const organizerId = await userIdFor(ctx, "organizer@openboard.dev");
  const secondReviewerId = await userIdFor(ctx, "reviewer2@openboard.dev");
  if (!reviewerId || !organizerId) {
    ctx.log("skipped — needs the seeded members (events.ts)");
    return;
  }

  const planId = ctx.id("plan", "round-1") as PlanId;
  const [existing] = (await tx.execute<{ id: string; status: string; reviews: number }>(sql`
    SELECT p.id, p.status, count(r.id)::int AS reviews
    FROM evaluation_plans p
    LEFT JOIN reviews r ON r.plan_id = p.id
    WHERE p.id = ${planId} AND p.event_id = ${eventId}
    GROUP BY p.id
  `)).rows ?? [];
  if (existing) {
    ctx.log(`Round 1 already exists (${existing.status}, ${Number(existing.reviews)} reviews) — left organizer changes alone`);
    return;
  }

  await savePlanIn(tx, eventId, planInputSchema.parse({
    planId,
    name: "Round 1",
    round: 1,
    scaleMin: 1,
    scaleMax: 5,
    status: "open",
    // The round itself is open to every track; the routing that matters for the
    // demo is the reviewer's own, below.
    trackIds: null,
    criteria: CRITERIA.map((criterion) => ({
      id: ctx.id("criterion", `round-1-${criterion.key}`),
      label: criterion.label,
      weight: criterion.weight,
    })),
  }));

  const reviewerTrackIds = REVIEWER_TRACKS.map((key) => ctx.id("track", key) as TrackId);
  await assignReviewersIn(tx, eventId, planId, [
    { userId: reviewerId, trackIds: reviewerTrackIds },
    { userId: organizerId, trackIds: null },
    ...(secondReviewerId ? [{ userId: secondReviewerId, trackIds: null }] : []),
  ]);

  const criterionScores = (scores: { relevance: number; quality: number }) => ({
    [ctx.id("criterion", "round-1-relevance")]: scores.relevance,
    [ctx.id("criterion", "round-1-quality")]: scores.quality,
  });

  // Only what the reviewer's own scope routes to them: scoring outside it is
  // exactly what `submitReview` refuses, and a seed must not model an
  // impossible state.
  const inScope = (await tx.execute<{ id: string }>(sql`
    SELECT s.id FROM submissions s
    WHERE s.event_id = ${eventId} AND s.status NOT IN ('draft', 'withdrawn')
      AND s.track_id = ANY(${sql`ARRAY[${sql.join(reviewerTrackIds.map((id) => sql`${id}::uuid`), sql`, `)}]`})
    ORDER BY s.code
  `)).rows ?? [];

  // M50: track scope only *suggests* who should get what; the queue is the
  // explicit assignment. Seeding both keeps the demo's routing story and gives
  // the reviewer an actual worklist.
  const inScopeIds = inScope.map((row) => row.id as SubmissionId);
  await assignSubmissionsIn(tx, eventId, {
    planId,
    reviewerUserIds: [reviewerId],
    submissionIds: inScopeIds,
    mode: "replace",
  });
  const everySubmission = ((await tx.execute<{ id: string }>(sql`
    SELECT s.id FROM submissions s
    WHERE s.event_id = ${eventId} AND s.status NOT IN ('draft', 'withdrawn')
    ORDER BY s.code
  `)).rows ?? []).map((row) => row.id as SubmissionId);
  await assignSubmissionsIn(tx, eventId, {
    planId,
    reviewerUserIds: [organizerId],
    submissionIds: everySubmission,
    mode: "replace",
  });
  if (secondReviewerId) {
    await assignSubmissionsIn(tx, eventId, {
      planId,
      reviewerUserIds: [secondReviewerId],
      submissionIds: inScopeIds,
      mode: "replace",
    });
  }

  const alreadyScored = new Set(((await tx.execute<{ submission_id: string; reviewer_user_id: string }>(sql`
    SELECT submission_id, reviewer_user_id FROM reviews WHERE plan_id = ${planId}
  `)).rows ?? []).map((row) => `${row.submission_id}:${row.reviewer_user_id}`));

  let written = 0;
  const score = async (submissionId: SubmissionId, userId: UserId, scores: { relevance: number; quality: number }, comment: string) => {
    if (alreadyScored.has(`${submissionId}:${userId}`)) return;
    await submitReviewIn(tx, eventId, planId, submissionId, userId, {
      overallScore: null,
      criterionScores: criterionScores(scores),
      comment,
    });
    written += 1;
  };

  for (const [index, scores] of REVIEWER_SCORES.entries()) {
    const submissionId = inScope[index]?.id as SubmissionId | undefined;
    if (!submissionId) break;
    await score(submissionId, reviewerId, scores, "Clear framing and a concrete demo; would attend.");
  }
  // The organizer scores from the far end of the same list, so a handful of
  // abstracts carry two verdicts and the rest carry one or none.
  for (const [index, scores] of ORGANIZER_SCORES.entries()) {
    const submissionId = inScope.at(-(index + 1))?.id as SubmissionId | undefined;
    if (!submissionId) break;
    await score(submissionId, organizerId, scores, "Strong, but overlaps another accepted talk.");
  }

  // The second reviewer leaves everything outstanding except one abstract they
  // stepped away from: "assigned / completed / outstanding / recused" is only a
  // useful fixture when all four states are on screen at once.
  if (secondReviewerId && inScopeIds[0]) {
    await recuseAssignmentIn(tx, eventId, planId, inScopeIds[0], secondReviewerId, "I co-authored a paper with one of the speakers");
  }

  // Round 2 is where the typed scorecard, the window and blind review live.
  // It is deliberately *not* scored: the demo needs a round that has not
  // started as well as one that is half done.
  const round2Id = ctx.id("plan", "round-2") as PlanId;
  const [round2Exists] = (await tx.execute<{ id: string }>(sql`
    SELECT id FROM evaluation_plans WHERE id = ${round2Id} AND event_id = ${eventId}
  `)).rows ?? [];
  if (!round2Exists) {
    const opensAt = new Date(ctx.now.getTime() - 24 * 60 * 60 * 1000);
    const closesAt = new Date(ctx.now.getTime() + 14 * 24 * 60 * 60 * 1000);
    await savePlanIn(tx, eventId, planInputSchema.parse({
      planId: round2Id,
      name: "Round 2 · Blind shortlist",
      round: 2,
      scaleMin: 1,
      scaleMax: 5,
      status: "open",
      trackIds: null,
      opensAt: opensAt.toISOString(),
      closesAt: closesAt.toISOString(),
      anonymizeAuthors: true,
      criteria: [
        { id: ctx.id("criterion", "round-2-originality"), label: "Originality", weight: 2, kind: "numeric", required: true },
        {
          id: ctx.id("criterion", "round-2-recommendation"),
          label: "Recommendation",
          weight: 1,
          kind: "select",
          required: true,
          options: [
            { id: "strong_accept", label: "Strong accept", score: 5 },
            { id: "accept", label: "Accept", score: 4 },
            { id: "reject", label: "Reject", score: 1 },
            { id: "abstain", label: "Abstain", score: null },
          ],
        },
        { id: ctx.id("criterion", "round-2-notes"), label: "Notes for the committee", weight: 1, kind: "text", required: false },
      ],
    }));
    await assignReviewersIn(tx, eventId, round2Id, [
      { userId: reviewerId, trackIds: null },
      ...(secondReviewerId ? [{ userId: secondReviewerId, trackIds: null }] : []),
    ]);
    await assignSubmissionsIn(tx, eventId, {
      planId: round2Id,
      reviewerUserIds: secondReviewerId ? [reviewerId, secondReviewerId] : [reviewerId],
      submissionIds: everySubmission.slice(0, 5),
      mode: "replace",
    });
  }

  if (inScope.length === 0) {
    ctx.log(`seeded Round 1 (1–5, ${CRITERIA.length} criteria) and 2 reviewers — no abstracts are routed to the reviewer yet`);
  } else {
    ctx.log(
      written > 0
        ? `seeded Round 1 (1–5, ${CRITERIA.length} criteria), 2 reviewers, ${written} scores across ${inScope.length} in-scope abstracts`
        : `Round 1 is already scored — left ${alreadyScored.size} existing reviews alone`,
    );
  }
}
