import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbOrTx } from "@/db/client";
import * as schema from "@/db/schema";
import {
  assignReviewersIn,
  deletePlanIn,
  getActivePlanIn,
  getRatingsIn,
  listPlansIn,
  listSubmissionsIn,
  planInputSchema,
  savePlanIn,
  submissionFiltersSchema,
} from "@/features/submissions";
import {
  eventIdSchema,
  submissionIdSchema,
  trackIdSchema,
  userIdSchema,
  type PlanId,
  type SubmissionId,
  type UserId,
} from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";

const migration0 = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");

const eventId = eventIdSchema.parse("b2000000-0000-4000-8000-000000000001");
const otherEventId = eventIdSchema.parse("b2000000-0000-4000-8000-000000000002");
const platforms = trackIdSchema.parse("b2000000-0000-4000-8000-000000000010");
const agents = trackIdSchema.parse("b2000000-0000-4000-8000-000000000011");
const foreignTrack = trackIdSchema.parse("b2000000-0000-4000-8000-000000000012");
const ada = userIdSchema.parse("b2000000-0000-4000-8000-000000000020");
const grace = userIdSchema.parse("b2000000-0000-4000-8000-000000000021");
const stranger = userIdSchema.parse("b2000000-0000-4000-8000-000000000022");
const platformsTalk = submissionIdSchema.parse("b2000000-0000-4000-8000-000000000030");
const agentsTalk = submissionIdSchema.parse("b2000000-0000-4000-8000-000000000031");
const draftTalk = submissionIdSchema.parse("b2000000-0000-4000-8000-000000000032");
const untracked = submissionIdSchema.parse("b2000000-0000-4000-8000-000000000033");

let pglite: PGlite;
let db: DbOrTx;

const planInput = (overrides: Record<string, unknown> = {}) =>
  planInputSchema.parse({ name: "Round 1", round: 1, scaleMin: 1, scaleMax: 5, ...overrides });

async function seedPlan(overrides: Record<string, unknown> = {}): Promise<PlanId> {
  const { planId } = await savePlanIn(db, eventId, planInput(overrides));
  return planId;
}

/**
 * A finished review, written directly. The scoring path itself belongs to the
 * reviewer queue; what these cases need is a round that already has verdicts in
 * it, so that deleting, reassigning and rating can be checked against one.
 */
async function giveReview(planId: PlanId, submissionId: SubmissionId, reviewerUserId: UserId, score: number): Promise<void> {
  await pglite.query(
    "INSERT INTO reviews(event_id,plan_id,submission_id,reviewer_user_id,overall_score,submitted_at) VALUES($1,$2,$3,$4,$5, now())",
    [eventId, planId, submissionId, reviewerUserId, score],
  );
}

describe("evaluation plans and reviewer routing", () => {
  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migration0);
    await pglite.exec(migration1);
    db = drizzle(pglite, { schema }) as unknown as DbOrTx;

    for (const [id, slug] of [[eventId, "eval-event"], [otherEventId, "eval-other"]] as const) {
      await pglite.query(
        "INSERT INTO events(id,name,slug,starts_at,ends_at) VALUES($1,$2,$3,'2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
        [id, `Event ${slug}`, slug],
      );
    }
    await pglite.query("INSERT INTO tracks(id,event_id,name,color) VALUES($1,$2,'Platforms','#6958d7')", [platforms, eventId]);
    await pglite.query("INSERT INTO tracks(id,event_id,name,color) VALUES($1,$2,'AI Agents','#22a06b')", [agents, eventId]);
    await pglite.query("INSERT INTO tracks(id,event_id,name,color) VALUES($1,$2,'Elsewhere','#c9372c')", [foreignTrack, otherEventId]);

    for (const [id, email, name] of [
      [ada, "ada@example.com", "Ada Lovelace"],
      [grace, "grace@example.com", "Grace Hopper"],
      [stranger, "stranger@example.com", "Not A Member"],
    ] as const) {
      await pglite.query("INSERT INTO users(id,email,name) VALUES($1,$2,$3)", [id, email, name]);
    }
    for (const userId of [ada, grace]) {
      await pglite.query("INSERT INTO event_members(user_id,event_id,role) VALUES($1,$2,'reviewer')", [userId, eventId]);
    }

    for (const [id, code, title, trackId, status] of [
      [platformsTalk, 1, "Caching at the edge", platforms, "pending"],
      [agentsTalk, 2, "Agents that ship", agents, "pending"],
      [draftTalk, 3, "Still writing this", platforms, "draft"],
      [untracked, 4, "Unrouted proposal", null, "pending"],
    ] as const) {
      await pglite.query(
        "INSERT INTO submissions(id,event_id,code,title,track_id,status,submitted_at) VALUES($1,$2,$3,$4,$5,$6, now())",
        [id, eventId, code, title, trackId, status],
      );
    }
  });

  beforeEach(async () => {
    await pglite.exec("TRUNCATE reviews, reviewer_assignments, evaluation_criteria, evaluation_plans CASCADE");
  });

  it("creates a round with its criteria and reports it as active", async () => {
    const planId = await seedPlan({
      criteria: [{ label: "Relevance", weight: 1 }, { label: "Quality", weight: 3 }],
    });

    const active = await getActivePlanIn(db, eventId);
    expect(active?.id).toBe(planId);
    expect(active?.criteria.map((criterion) => criterion.label)).toEqual(["Relevance", "Quality"]);
    expect(active?.criteria.map((criterion) => criterion.weight)).toEqual([1, 3]);
    // Three of the four seeded submissions are scorable; the draft is not.
    expect(active?.progress).toEqual({ scored: 0, total: 3 });
  });

  it("prefers an open round, then the lowest, as the active one", async () => {
    const roundOne = await seedPlan({ name: "Round 1", round: 1, status: "closed" });
    const roundTwo = await savePlanIn(db, eventId, planInput({ name: "Round 2", round: 2 }));
    expect((await getActivePlanIn(db, eventId))?.id).toBe(roundTwo.planId);

    await savePlanIn(db, eventId, planInput({ planId: roundOne, name: "Round 1", round: 1, status: "open" }));
    expect((await getActivePlanIn(db, eventId))?.id).toBe(roundOne);
  });

  it("keeps criterion ids across an edit so existing scores stay attached", async () => {
    const planId = await seedPlan({ criteria: [{ label: "Relevance", weight: 1 }] });
    const before = await getActivePlanIn(db, eventId);
    const criterionId = before?.criteria[0]?.id;

    await savePlanIn(db, eventId, planInput({
      planId,
      name: "Round 1 revised",
      criteria: [{ id: criterionId, label: "Relevance to the track", weight: 2 }, { label: "Delivery", weight: 1 }],
    }));

    const after = await getActivePlanIn(db, eventId);
    expect(after?.name).toBe("Round 1 revised");
    expect(after?.criteria[0]?.id).toBe(criterionId);
    expect(after?.criteria.map((criterion) => criterion.label)).toEqual(["Relevance to the track", "Delivery"]);
  });

  it("reports a duplicate round name as a field error, not a crash", async () => {
    await seedPlan();
    const error = await savePlanIn(db, eventId, planInput()).catch((thrown: unknown) => thrown);
    expect(isAppError(error) && error.code).toBe("VALIDATION");
    expect(isAppError(error) && (error.details as { fieldErrors: Record<string, string> }).fieldErrors.name).toBeTruthy();
  });

  it("refuses a track that belongs to another event", async () => {
    const error = await savePlanIn(db, eventId, planInput({ trackIds: [foreignTrack] })).catch((thrown: unknown) => thrown);
    expect(isAppError(error) && error.code).toBe("VALIDATION");
  });

  it("rejects an edit that raced another organizer", async () => {
    const planId = await seedPlan();
    const stale = new Date(Date.now() - 60_000).toISOString();
    const error = await savePlanIn(db, eventId, planInput({ planId, name: "Renamed" }), stale)
      .catch((thrown: unknown) => thrown);
    expect(isAppError(error) && error.code).toBe("STALE_WRITE");
  });

  it("sizes each reviewer's slice by the effective scope rule", async () => {
    const planId = await seedPlan();
    await assignReviewersIn(db, eventId, planId, [
      { userId: ada, trackIds: [platforms] },
      { userId: grace, trackIds: null },
    ]);
    await giveReview(planId, platformsTalk, ada, 4);

    const [plan] = await listPlansIn(db, eventId);
    const byUser = Object.fromEntries((plan?.reviewers ?? []).map((reviewer) => [reviewer.userId, reviewer]));
    // Ada is scoped to Platforms: one pending talk, since the draft is scoped out
    // for everyone. Grace's open scope also picks up the untracked proposal.
    expect(byUser[ada]).toMatchObject({ scored: 1, assigned: 1 });
    expect(byUser[grace]).toMatchObject({ scored: 0, assigned: 3 });
    expect(plan?.progress).toEqual({ scored: 1, total: 3 });
  });

  it("narrows the round's own scope to its tracks", async () => {
    const planId = await seedPlan({ trackIds: [agents] });
    await assignReviewersIn(db, eventId, planId, [{ userId: grace, trackIds: null }]);
    const [plan] = await listPlansIn(db, eventId);
    // An open assignment cannot widen the round: the untracked proposal is out
    // of scope the moment the plan names a track.
    expect(plan?.progress.total).toBe(1);
    expect(plan?.reviewers[0]?.assigned).toBe(1);
  });

  it("refuses to route submissions to someone who is not a member", async () => {
    const planId = await seedPlan();
    const error = await assignReviewersIn(db, eventId, planId, [{ userId: stranger, trackIds: null }])
      .catch((thrown: unknown) => thrown);
    expect(isAppError(error) && error.code).toBe("VALIDATION");
    const rows = await pglite.query<{ n: number }>("SELECT count(*)::int AS n FROM reviewer_assignments");
    expect(rows.rows[0]?.n).toBe(0);
  });

  it("drops a reviewer's routing without dropping their scores", async () => {
    const planId = await seedPlan();
    await assignReviewersIn(db, eventId, planId, [{ userId: ada, trackIds: null }, { userId: grace, trackIds: null }]);
    await giveReview(planId, platformsTalk, grace, 5);

    await assignReviewersIn(db, eventId, planId, [{ userId: ada, trackIds: [agents] }]);
    const [plan] = await listPlansIn(db, eventId);
    expect(plan?.reviewers.map((reviewer) => reviewer.userId)).toEqual([ada]);
    expect(plan?.reviewers[0]?.trackIds).toEqual([agents]);
    // Reassignment changes what is next, never what was already judged.
    expect((await getRatingsIn(db, eventId, planId)).get(platformsTalk)).toEqual({ rating: 5, nScores: 1 });
  });

  it("leaves a review still in progress out of the rating", async () => {
    const planId = await seedPlan();
    await pglite.query(
      "INSERT INTO reviews(event_id,plan_id,submission_id,reviewer_user_id,overall_score,comment,submitted_at) VALUES($1,$2,$3,$4,NULL,'Thinking', now())",
      [eventId, planId, agentsTalk, ada],
    );
    await giveReview(planId, platformsTalk, ada, 3);
    await giveReview(planId, platformsTalk, grace, 4);

    const ratings = await getRatingsIn(db, eventId, planId);
    // Two verdicts averaged; the unscored one is absent rather than a zero.
    expect(ratings.get(platformsTalk)).toEqual({ rating: 3.5, nScores: 2 });
    expect(ratings.has(agentsTalk)).toBe(false);
  });

  it("closes a round with reviews instead of deleting it", async () => {
    const planId = await seedPlan();
    await giveReview(planId, platformsTalk, ada, 4);

    const error = await deletePlanIn(db, eventId, planId).catch((thrown: unknown) => thrown);
    expect(isAppError(error) && error.code).toBe("CONFLICT");
    expect(isAppError(error) && error.message).toContain("1 review");

    const empty = await savePlanIn(db, eventId, planInput({ name: "Round 2", round: 2 }));
    await deletePlanIn(db, eventId, empty.planId);
    expect((await listPlansIn(db, eventId)).map((plan) => plan.id)).toEqual([planId]);
  });

  it("will not touch a plan through another event's id", async () => {
    const planId = await seedPlan();
    const renamed = await savePlanIn(db, otherEventId, planInput({ planId, name: "Hijacked" }))
      .catch((thrown: unknown) => thrown);
    expect(isAppError(renamed) && renamed.code).toBe("NOT_FOUND");
    const removed = await deletePlanIn(db, otherEventId, planId).catch((thrown: unknown) => thrown);
    expect(isAppError(removed) && removed.code).toBe("NOT_FOUND");
    expect((await listPlansIn(db, eventId)).map((plan) => plan.name)).toEqual(["Round 1"]);
  });

  it("shows the Abstracts table the active round's rating, not a mean of every round", async () => {
    const roundOne = await seedPlan({ name: "Round 1", round: 1 });
    const roundTwo = await savePlanIn(db, eventId, planInput({ name: "Round 2", round: 2 }));
    await giveReview(roundOne, platformsTalk, ada, 2);
    await giveReview(roundTwo.planId, platformsTalk, ada, 5);

    const list = await listSubmissionsIn(db, eventId, submissionFiltersSchema.parse({ search: "Caching" }));
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0]?.rating).toBe(2);
    expect(list.rows[0]?.nScores).toBe(1);
  });
});
