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

type Cast = {
  reviewerId: UserId;
  organizerId: UserId;
  secondReviewerId: UserId | null;
  /** Every scorable abstract in code order — both rounds hand work out of it. */
  everySubmission: SubmissionId[];
};

export async function seedEvaluation(ctx: SeedCtx): Promise<void> {
  const { tx, eventId } = ctx;

  const reviewerId = await userIdFor(ctx, "reviewer@openboard.dev");
  const organizerId = await userIdFor(ctx, "organizer@openboard.dev");
  const secondReviewerId = await userIdFor(ctx, "reviewer2@openboard.dev");
  if (!reviewerId || !organizerId) {
    ctx.log("skipped — needs the seeded members (events.ts)");
    return;
  }

  const everySubmission = ((await tx.execute<{ id: string }>(sql`
    SELECT s.id FROM submissions s
    WHERE s.event_id = ${eventId} AND s.status NOT IN ('draft', 'withdrawn')
    ORDER BY s.code
  `)).rows ?? []).map((row) => row.id as SubmissionId);

  const cast: Cast = { reviewerId, organizerId, secondReviewerId, everySubmission };
  await seedRound1(ctx, cast);
  // Round 2 is seeded independently of Round 1, and deliberately so. An
  // existing Round 1 used to end this function, which meant a database seeded
  // before M50 — Round 1 present, Round 2 absent — could never acquire the
  // blind, windowed, typed round that M50's surfaces and its e2e spec are
  // written against, however many times the seed was re-run. Each round now
  // guards only itself, so a re-run fills in what is missing and leaves what is
  // there alone.
  await seedRound2(ctx, cast);
}

/**
 * The scored, open, untyped round: M19's fixture, unchanged. It is skipped
 * wholesale once it exists, so a walkthrough verdict, a closed status or a
 * hand-edited criterion label all survive a re-run.
 */
async function seedRound1(ctx: SeedCtx, cast: Cast): Promise<void> {
  const { tx, eventId } = ctx;
  const { reviewerId, organizerId, secondReviewerId, everySubmission } = cast;

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
  await assignReviewersIn((work) => work(tx), eventId, planId, [
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
  await assignSubmissionsIn((work) => work(tx), eventId, {
    planId,
    reviewerUserIds: [reviewerId],
    submissionIds: inScopeIds,
    mode: "replace",
  });
  await assignSubmissionsIn((work) => work(tx), eventId, {
    planId,
    reviewerUserIds: [organizerId],
    submissionIds: everySubmission,
    mode: "replace",
  });
  if (secondReviewerId) {
    await assignSubmissionsIn((work) => work(tx), eventId, {
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

/**
 * M50's own fixture: the typed scorecard, the half-open window and blind
 * review, in one round — carrying all four assignment states at once, because
 * "assigned / completed / outstanding / recused" is only a useful progress
 * screen when every column has a number in it.
 *
 * The reviewer the deployed spec signs in as is left entirely *outstanding*:
 * their queue is the spec's fixture, and a seed that pre-scored it would leave
 * the spec asserting on its own leftovers instead of on the seed. The second
 * reviewer supplies the finished and stepped-away rows, and the organizer is
 * the third pair of eyes on the round.
 *
 * The *plan* is guarded by its own existence, so it appears on a database that
 * was seeded before this round existed rather than waiting for a wipe. The
 * fixture on it is guarded separately, by whether the fixture is there: a
 * database that carries the two-reviewer, nobody-has-scored-anything Round 2
 * this module replaced would otherwise be skipped wholesale by an
 * existence-only check, and could never acquire the third reviewer or the
 * completed and recused rows the progress screen exists to show — the same
 * "already exists, therefore already right" mistake this module fixed for
 * Round 1 and for the seeded submission answers. Once the fixture is present,
 * one completed row or one recusal is enough to hand the round back to the
 * organizer permanently.
 */
async function seedRound2(ctx: SeedCtx, cast: Cast): Promise<void> {
  const { tx, eventId } = ctx;

  const round2Id = ctx.id("plan", "round-2") as PlanId;
  const [exists] = (await tx.execute<{
    status: string; opens_at: string | null; closes_at: string | null; completed: number; recused: number;
  }>(sql`
    SELECT p.status, p.opens_at, p.closes_at,
      (SELECT count(*)::int FROM reviews r
        WHERE r.plan_id = p.id AND r.submitted_at IS NOT NULL) AS completed,
      (SELECT count(*)::int FROM review_assignments ra
        WHERE ra.plan_id = p.id AND ra.status = 'recused') AS recused
    FROM evaluation_plans p WHERE p.id = ${round2Id} AND p.event_id = ${eventId}
  `)).rows ?? [];
  if (exists) {
    // Someone has scored or stepped away: the four states are on screen, and
    // whatever shape the round is in now is the organizer's, not the seed's.
    if (Number(exists.completed) > 0 || Number(exists.recused) > 0) {
      ctx.log(`Round 2 already exists (${Number(exists.completed)} completed, ${Number(exists.recused)} recused) — left organizer changes alone`);
      return;
    }
    // The fixture is missing, but the round can no longer take a verdict —
    // `submitReview` refuses outside the window, and moving the window would be
    // rewriting an organizer's round rather than filling in a gap. Say so
    // instead of leaving it silently unmet.
    if (exists.status !== "open" || !isOpenAt(exists, ctx.now)) {
      ctx.log("Round 2 exists but is closed or outside its window — left alone, so it carries no completed or recused row");
      return;
    }
    await fillRound2(ctx, cast, round2Id, true);
    return;
  }

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
  await fillRound2(ctx, cast, round2Id, false);
}

/** Half-open, and read against the seed's own clock rather than the wall's. */
function isOpenAt(plan: { opens_at: string | null; closes_at: string | null }, now: Date): boolean {
  const opens = plan.opens_at ? new Date(plan.opens_at).getTime() : null;
  const closes = plan.closes_at ? new Date(plan.closes_at).getTime() : null;
  return (opens === null || opens <= now.getTime()) && (closes === null || closes > now.getTime());
}

/**
 * The rows that make Round 2 a fixture rather than an empty round: the three
 * reviewers, their shortlist, one finished verdict and one recusal.
 *
 * Written additively so the same code serves a fresh round and a top-up. On a
 * top-up it adds only what is missing — a reviewer who is already on the round
 * keeps the scope and the queue they have, and a queue somebody curated is
 * never re-cut — because the round it is repairing may be one an organizer has
 * already worked on.
 */
async function fillRound2(ctx: SeedCtx, cast: Cast, round2Id: PlanId, toppingUp: boolean): Promise<void> {
  const { tx, eventId } = ctx;
  const { reviewerId, organizerId, secondReviewerId } = cast;

  // `assignReviewersIn` replaces the reviewer set wholesale, so a top-up hands
  // it the union: everyone already on the round, each keeping the scope they
  // have (an unchanged scope leaves their queue untouched), plus the cast
  // members who are missing. Passing only the cast would drop a reviewer an
  // organizer added by hand.
  const seated = ((await tx.execute<{ user_id: string; track_ids: string[] | null }>(sql`
    SELECT a.user_id, a.track_ids FROM reviewer_assignments a
    JOIN event_members m ON m.user_id = a.user_id AND m.event_id = ${eventId}
    WHERE a.plan_id = ${round2Id} AND a.event_id = ${eventId}
    ORDER BY a.user_id
  `)).rows ?? []);
  const seatedIds = new Set(seated.map((row) => row.user_id));
  const cast3 = [reviewerId, ...(secondReviewerId ? [secondReviewerId] : []), organizerId];
  const newcomers = cast3.filter((userId) => !seatedIds.has(userId));
  const pool = [
    ...seated.map((row) => ({ userId: row.user_id as UserId, trackIds: (row.track_ids ?? null) as TrackId[] | null })),
    ...newcomers.map((userId) => ({ userId, trackIds: null })),
  ];
  await assignReviewersIn((work) => work(tx), eventId, round2Id, pool);

  // The shortlist, read through the round's own track scope so a narrowed round
  // cannot be handed work `assignSubmissions` would refuse.
  const shortlist = ((await tx.execute<{ id: string }>(sql`
    SELECT s.id FROM submissions s, evaluation_plans p
    WHERE p.id = ${round2Id} AND p.event_id = ${eventId}
      AND s.event_id = ${eventId} AND s.status NOT IN ('draft', 'withdrawn')
      AND (p.track_ids IS NULL OR s.track_id = ANY(p.track_ids))
    ORDER BY s.code LIMIT 5
  `)).rows ?? []).map((row) => row.id as SubmissionId);

  // Only reviewers who have no queue at all get one. `assignReviewersIn` above
  // has just materialized a full-scope queue for anyone new to the round, and
  // `replace` cuts that down to the shortlist; anyone who was already here
  // keeps whatever queue they had, curated or not.
  const queued = new Map(((await tx.execute<{ reviewer_user_id: string; n: number }>(sql`
    SELECT reviewer_user_id, count(*)::int AS n FROM review_assignments
    WHERE plan_id = ${round2Id} AND event_id = ${eventId}
    GROUP BY reviewer_user_id
  `)).rows ?? []).map((row) => [row.reviewer_user_id, Number(row.n)]));
  const empties = pool
    .map((member) => member.userId)
    .filter((userId) => (queued.get(userId) ?? 0) === 0 || newcomers.includes(userId));
  if (empties.length > 0 && shortlist.length > 0) {
    await assignSubmissionsIn((work) => work(tx), eventId, {
      planId: round2Id,
      reviewerUserIds: empties,
      submissionIds: shortlist,
      mode: "replace",
    });
  }

  // One finished verdict and one recusal, both from the second reviewer, so the
  // organizer's progress table shows a completed count, an outstanding count
  // and a recusal without anyone having to work the queue first. The verdict
  // uses all three criterion kinds: a numeric value, a *scored* option, and
  // written feedback that deliberately contributes nothing to the mean.
  //
  // Both are taken from the second reviewer's *actual* outstanding queue rather
  // than from the shortlist, so a top-up recuses an abstract they really hold.
  const outstanding = secondReviewerId
    ? ((await tx.execute<{ submission_id: string }>(sql`
      SELECT ra.submission_id FROM review_assignments ra
      JOIN submissions s ON s.id = ra.submission_id
      WHERE ra.plan_id = ${round2Id} AND ra.event_id = ${eventId}
        AND ra.reviewer_user_id = ${secondReviewerId} AND ra.status = 'assigned'
      ORDER BY s.code
    `)).rows ?? []).map((row) => row.submission_id as SubmissionId)
    : [];
  // Every criterion the verdict scores has to still be on the round; an
  // organizer who deleted one owns this scorecard now, and `submitReview` would
  // reject the value rather than write it.
  const criteria = new Set(((await tx.execute<{ id: string }>(sql`
    SELECT id FROM evaluation_criteria WHERE plan_id = ${round2Id}
  `)).rows ?? []).map((row) => row.id));
  const scored = ["round-2-originality", "round-2-recommendation", "round-2-notes"].map((key) => ctx.id("criterion", key));
  const [finished, steppedAwayFrom] = outstanding;
  let wrote = false;
  if (secondReviewerId && finished && steppedAwayFrom && scored.every((id) => criteria.has(id))) {
    await submitReviewIn(tx, eventId, round2Id, finished, secondReviewerId, {
      overallScore: null,
      criterionScores: {
        [scored[0] as string]: { kind: "numeric" as const, value: 4 },
        [scored[1] as string]: { kind: "select" as const, optionId: "accept" },
        [scored[2] as string]: { kind: "text" as const, value: "Worth a slot if the room is small enough for questions." },
      },
      comment: "Blind read: the approach section carries this one.",
    }, ctx.now);
    await recuseAssignmentIn(tx, eventId, round2Id, steppedAwayFrom, secondReviewerId, "I work with the team behind this proposal");
    wrote = true;
  }

  ctx.log(
    (toppingUp
      ? `topped up Round 2 (${newcomers.length} reviewer(s) added)`
      : "seeded Round 2 (blind, windowed, numeric/select/text)")
    + ` over ${shortlist.length} shortlisted abstracts for ${pool.length} reviewers`
    + (wrote ? ", one completed and one recused" : ", with no completed or recused row"),
  );
}
