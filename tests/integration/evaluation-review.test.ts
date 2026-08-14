import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbOrTx } from "@/db/client";
import * as schema from "@/db/schema";
import {
  assignReviewersIn,
  assertReviewerCanReadSubmissionIn,
  getActivePlanIn,
  getPlanIn,
  getRatingsIn,
  listReviewQueueIn,
  planInputSchema,
  savePlanIn,
  submitReviewIn,
} from "@/features/submissions";
import {
  eventIdSchema,
  planIdSchema,
  submissionIdSchema,
  trackIdSchema,
  userIdSchema,
  type PlanId,
} from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";

const migration0 = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");
// M50 is additive on top of the base schema; these suites exercise the columns
// and the assignment table it adds.
const migration4 = readFileSync(new URL("../../drizzle/0004_review_operations.sql", import.meta.url), "utf8");
const migration26 = readFileSync(new URL("../../drizzle/0026_independent_review_scoring.sql", import.meta.url), "utf8");

const eventId = eventIdSchema.parse("b3000000-0000-4000-8000-000000000001");
const platforms = trackIdSchema.parse("b3000000-0000-4000-8000-000000000010");
const agents = trackIdSchema.parse("b3000000-0000-4000-8000-000000000011");
const ada = userIdSchema.parse("b3000000-0000-4000-8000-000000000020");
const grace = userIdSchema.parse("b3000000-0000-4000-8000-000000000021");
const platformsTalk = submissionIdSchema.parse("b3000000-0000-4000-8000-000000000030");
const agentsTalk = submissionIdSchema.parse("b3000000-0000-4000-8000-000000000031");
const draftTalk = submissionIdSchema.parse("b3000000-0000-4000-8000-000000000032");
const untracked = submissionIdSchema.parse("b3000000-0000-4000-8000-000000000033");

let pglite: PGlite;
let db: DbOrTx;
let runEvaluationTransaction: <T>(work: (tx: DbOrTx) => Promise<T>) => Promise<T>;

const planInput = (overrides: Record<string, unknown> = {}) =>
  planInputSchema.parse({ name: "Round 1", round: 1, scaleMin: 1, scaleMax: 5, ...overrides });

async function seedPlan(overrides: Record<string, unknown> = {}): Promise<PlanId> {
  const { planId } = await savePlanIn(runEvaluationTransaction, eventId, planInput(overrides));
  return planId;
}

const verdict = (overrides: Partial<{ overallScore: number | null; criterionScores: Record<string, number>; comment: string | null }> = {}) =>
  ({ overallScore: 4, criterionScores: {}, comment: null, ...overrides });

describe("reviewer queue and scoring", () => {
  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migration0);
    await pglite.exec(migration1);
    await pglite.exec(migration4);
    await pglite.exec(migration26);
    const database = drizzle(pglite, { schema });
    db = database as unknown as DbOrTx;
    runEvaluationTransaction = (work) => database.transaction((tx) => work(tx as unknown as DbOrTx));

    await pglite.query(
      "INSERT INTO events(id,name,slug,starts_at,ends_at) VALUES($1,'Review event','review-event','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
      [eventId],
    );
    await pglite.query("INSERT INTO tracks(id,event_id,name,color) VALUES($1,$2,'Platforms','#6958d7')", [platforms, eventId]);
    await pglite.query("INSERT INTO tracks(id,event_id,name,color) VALUES($1,$2,'AI Agents','#22a06b')", [agents, eventId]);

    for (const [id, email, name] of [
      [ada, "ada@example.com", "Ada Lovelace"],
      [grace, "grace@example.com", "Grace Hopper"],
    ] as const) {
      await pglite.query("INSERT INTO users(id,email,name) VALUES($1,$2,$3)", [id, email, name]);
      await pglite.query("INSERT INTO event_members(user_id,event_id,role) VALUES($1,$2,'reviewer')", [id, eventId]);
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

  it("routes disjoint queues to two track-scoped reviewers", async () => {
    const planId = await seedPlan();
    await assignReviewersIn(runEvaluationTransaction, eventId, planId, [
      { userId: ada, trackIds: [platforms] },
      { userId: grace, trackIds: [agents] },
    ]);

    const adaQueue = await listReviewQueueIn(db, eventId, ada, planId);
    const graceQueue = await listReviewQueueIn(db, eventId, grace, planId);
    expect(adaQueue.rows.map((row) => row.submissionId)).toEqual([platformsTalk]);
    expect(graceQueue.rows.map((row) => row.submissionId)).toEqual([agentsTalk]);
    // The draft is scoped out for everyone, whatever the assignment says.
    expect(adaQueue.rows.some((row) => row.submissionId === draftTalk)).toBe(false);

    await assignReviewersIn(runEvaluationTransaction, eventId, planId, [{ userId: ada, trackIds: null }]);
    const openQueue = await listReviewQueueIn(db, eventId, ada, planId);
    // Only an unscoped assignment reaches the proposal that has no track.
    expect(openQueue.rows.map((row) => row.submissionId).sort()).toEqual([platformsTalk, agentsTalk, untracked].sort());
  });

  it("applies queue scope to reviewer detail access", async () => {
    const planId = await seedPlan();
    await assignReviewersIn(runEvaluationTransaction, eventId, planId, [{ userId: ada, trackIds: [platforms] }]);

    await expect(assertReviewerCanReadSubmissionIn(db, eventId, planId, platformsTalk, ada)).resolves.toBeUndefined();
    const outOfTrack = await assertReviewerCanReadSubmissionIn(db, eventId, planId, agentsTalk, ada)
      .catch((thrown: unknown) => thrown);
    const unassigned = await assertReviewerCanReadSubmissionIn(db, eventId, planId, platformsTalk, grace)
      .catch((thrown: unknown) => thrown);
    expect(isAppError(outOfTrack) && outOfTrack.code).toBe("FORBIDDEN");
    expect(isAppError(unassigned) && unassigned.code).toBe("FORBIDDEN");
  });

  it("falls back to the active round when no plan is named", async () => {
    const planId = await seedPlan();
    await assignReviewersIn(runEvaluationTransaction, eventId, planId, [{ userId: ada, trackIds: null }]);
    const queue = await listReviewQueueIn(db, eventId, ada, null);
    expect(queue.plan?.id).toBe(planId);
    expect(queue.rows).toHaveLength(3);
  });

  it("defaults to an open round assigned to this reviewer", async () => {
    const roundOne = await seedPlan({ name: "Round 1", round: 1 });
    const roundTwo = await savePlanIn(runEvaluationTransaction, eventId, planInput({ name: "Round 2", round: 2 }));
    await assignReviewersIn(runEvaluationTransaction, eventId, roundOne, [{ userId: grace, trackIds: null }]);
    await assignReviewersIn(runEvaluationTransaction, eventId, roundTwo.planId, [{ userId: ada, trackIds: [agents] }]);

    const queue = await listReviewQueueIn(db, eventId, ada, null);
    expect(queue.plan?.id).toBe(roundTwo.planId);
    expect(queue.rows.map((row) => row.submissionId)).toEqual([agentsTalk]);
  });

  it("gives an unassigned member an empty queue rather than the whole event", async () => {
    const planId = await seedPlan();
    await assignReviewersIn(runEvaluationTransaction, eventId, planId, [{ userId: ada, trackIds: null }]);
    const queue = await listReviewQueueIn(db, eventId, grace, planId);
    expect(queue.rows).toEqual([]);
    expect(queue.plan?.id).toBe(planId);
  });

  it("updates rather than duplicates when the same reviewer scores twice", async () => {
    const planId = await seedPlan();
    await assignReviewersIn(runEvaluationTransaction, eventId, planId, [{ userId: ada, trackIds: null }]);

    const first = await submitReviewIn(db, eventId, planId, platformsTalk, ada, verdict({ overallScore: 3, comment: "Solid" }));
    const second = await submitReviewIn(db, eventId, planId, platformsTalk, ada, verdict({ overallScore: 5, comment: "Better than I thought" }));
    expect(second.reviewId).toBe(first.reviewId);

    const rows = await pglite.query<{ n: number }>("SELECT count(*)::int AS n FROM reviews WHERE submission_id=$1", [platformsTalk]);
    expect(rows.rows[0]?.n).toBe(1);

    const queue = await listReviewQueueIn(db, eventId, ada, planId);
    const scored = queue.rows.find((row) => row.submissionId === platformsTalk);
    expect(scored?.myScore).toBe(5);
    expect(scored?.myComment).toBe("Better than I thought");
    expect(scored?.scoredAt).not.toBeNull();
    expect(queue.progress).toEqual({ scored: 1, total: 3 });
    // A worklist puts what still needs a verdict first.
    expect(queue.rows.at(-1)?.submissionId).toBe(platformsTalk);
  });

  it("computes the overall score from criteria server-side", async () => {
    const planId = await seedPlan({ criteria: [{ label: "Relevance", weight: 3 }, { label: "Quality", weight: 1 }] });
    await assignReviewersIn(runEvaluationTransaction, eventId, planId, [{ userId: ada, trackIds: null }]);
    const plan = await getActivePlanIn(db, eventId);
    const relevance = plan?.criteria[0]?.id ?? "";
    const quality = plan?.criteria[1]?.id ?? "";

    // The client's own overallScore is ignored when the round has criteria.
    const saved = await submitReviewIn(db, eventId, planId, platformsTalk, ada, verdict({
      overallScore: 1,
      criterionScores: { [relevance]: 3, [quality]: 5 },
    }));
    expect(saved.overallScore).toBe(3.5);

    const partial = await submitReviewIn(db, eventId, planId, agentsTalk, ada, verdict({
      overallScore: null,
      criterionScores: { [relevance]: 4 },
      comment: "Need to think about this one",
    }));
    expect(partial.overallScore).toBeNull();

    const ratings = await getRatingsIn(db, eventId, planId);
    expect(ratings.get(platformsTalk)).toEqual({ rating: 3.5, nScores: 1 });
    // A review still in progress is absent, not a zero dragging the average.
    expect(ratings.has(agentsTalk)).toBe(false);
    // It is still saved, so the reviewer picks up where they left off.
    const queue = await listReviewQueueIn(db, eventId, ada, planId);
    expect(queue.rows.find((row) => row.submissionId === agentsTalk)?.myCriterionScores).toEqual({ [relevance]: 4 });
  });

  it("locks the scoring formula after the first review without locking labels", async () => {
    const planId = await seedPlan({ criteria: [{ label: "Relevance", weight: 1 }] });
    await assignReviewersIn(runEvaluationTransaction, eventId, planId, [{ userId: ada, trackIds: null }]);
    const criterion = (await getPlanIn(db, eventId, planId)).criteria[0];
    await submitReviewIn(db, eventId, planId, platformsTalk, ada, verdict({
      criterionScores: { [criterion?.id ?? ""]: 4 },
    }));

    for (const override of [
      { criteria: [{ id: criterion?.id, label: "Relevance", weight: 2 }] },
      { criteria: [] },
      { scaleMax: 10, criteria: [{ id: criterion?.id, label: "Relevance", weight: 1 }] },
    ]) {
      const error = await savePlanIn(runEvaluationTransaction, eventId, planInput({ planId, ...override }))
        .catch((thrown: unknown) => thrown);
      expect(isAppError(error) && error.code).toBe("CONFLICT");
    }

    await savePlanIn(runEvaluationTransaction, eventId, planInput({
      planId,
      criteria: [{ id: criterion?.id, label: "Track relevance", weight: 1 }],
    }));
    const plan = await getPlanIn(db, eventId, planId);
    expect(plan.criteria[0]?.label).toBe("Track relevance");
    expect((await getRatingsIn(db, eventId, planId)).get(platformsTalk)?.rating).toBe(4);
  });

  it("rejects a score outside the round's scale", async () => {
    const planId = await seedPlan();
    await assignReviewersIn(runEvaluationTransaction, eventId, planId, [{ userId: ada, trackIds: null }]);
    const error = await submitReviewIn(db, eventId, planId, platformsTalk, ada, verdict({ overallScore: 9 }))
      .catch((thrown: unknown) => thrown);
    expect(isAppError(error) && error.code).toBe("VALIDATION");
  });

  it("rejects a criterion that belongs to another round", async () => {
    const planId = await seedPlan({ criteria: [{ label: "Relevance", weight: 1 }] });
    await assignReviewersIn(runEvaluationTransaction, eventId, planId, [{ userId: ada, trackIds: null }]);
    const error = await submitReviewIn(db, eventId, planId, platformsTalk, ada, verdict({
      overallScore: null,
      criterionScores: { [planIdSchema.parse("b3000000-0000-4000-8000-0000000000ff")]: 4 },
    })).catch((thrown: unknown) => thrown);
    expect(isAppError(error) && error.code).toBe("VALIDATION");
  });

  it("refuses a draft, a closed round, an unassigned reviewer, and somebody else's track", async () => {
    const planId = await seedPlan();
    await assignReviewersIn(runEvaluationTransaction, eventId, planId, [{ userId: ada, trackIds: [platforms] }]);

    const onDraft = await submitReviewIn(db, eventId, planId, draftTalk, ada, verdict()).catch((thrown: unknown) => thrown);
    expect(isAppError(onDraft) && onDraft.code).toBe("CONFLICT");

    // The queue never offered this one; sending its id directly must not work.
    const outOfScope = await submitReviewIn(db, eventId, planId, agentsTalk, ada, verdict()).catch((thrown: unknown) => thrown);
    expect(isAppError(outOfScope) && outOfScope.code).toBe("FORBIDDEN");

    const unassigned = await submitReviewIn(db, eventId, planId, platformsTalk, grace, verdict()).catch((thrown: unknown) => thrown);
    expect(isAppError(unassigned) && unassigned.code).toBe("FORBIDDEN");

    await savePlanIn(runEvaluationTransaction, eventId, planInput({ planId, status: "closed" }));
    const closed = await submitReviewIn(db, eventId, planId, platformsTalk, ada, verdict()).catch((thrown: unknown) => thrown);
    expect(isAppError(closed) && closed.code).toBe("CONFLICT");
    expect(await pglite.query<{ n: number }>("SELECT count(*)::int AS n FROM reviews").then((r) => r.rows[0]?.n)).toBe(0);
  });

  it("keeps existing scores when a reviewer's tracks change mid-round", async () => {
    const planId = await seedPlan();
    await assignReviewersIn(runEvaluationTransaction, eventId, planId, [{ userId: ada, trackIds: null }]);
    await submitReviewIn(db, eventId, planId, platformsTalk, ada, verdict());

    await assignReviewersIn(runEvaluationTransaction, eventId, planId, [{ userId: ada, trackIds: [agents] }]);
    const queue = await listReviewQueueIn(db, eventId, ada, planId);
    expect(queue.rows.map((row) => row.submissionId)).toEqual([agentsTalk]);

    // Reassignment changes what is next, never what was already judged.
    expect((await getRatingsIn(db, eventId, planId)).get(platformsTalk)?.rating).toBe(4);
  });

  it("keeps the committee average out of reviewer payloads by default", async () => {
    const planId = await seedPlan();
    await assignReviewersIn(runEvaluationTransaction, eventId, planId, [{ userId: ada, trackIds: null }, { userId: grace, trackIds: null }]);
    await submitReviewIn(db, eventId, planId, platformsTalk, ada, verdict({ overallScore: 3 }));
    await submitReviewIn(db, eventId, planId, platformsTalk, grace, verdict({ overallScore: 5 }));

    const queue = await listReviewQueueIn(db, eventId, ada, planId);
    const row = queue.rows.find((entry) => entry.submissionId === platformsTalk);
    expect(row?.myScore).toBe(3);
    expect(row?.avgRating).toBeNull();
    expect(row?.nScores).toBeNull();
  });

  it("shares the committee average only when the organizer opts in", async () => {
    const planId = await seedPlan({ showPeerScores: true });
    await assignReviewersIn(runEvaluationTransaction, eventId, planId, [{ userId: ada, trackIds: null }, { userId: grace, trackIds: null }]);
    await submitReviewIn(db, eventId, planId, platformsTalk, ada, verdict({ overallScore: 3 }));
    await submitReviewIn(db, eventId, planId, platformsTalk, grace, verdict({ overallScore: 5 }));

    const queue = await listReviewQueueIn(db, eventId, ada, planId);
    const row = queue.rows.find((entry) => entry.submissionId === platformsTalk);
    expect(queue.plan?.showPeerScores).toBe(true);
    expect(row?.avgRating).toBe(4);
    expect(row?.nScores).toBe(2);
  });

  it("keeps two rounds' verdicts apart", async () => {
    const roundOne = await seedPlan({ name: "Round 1", round: 1 });
    const roundTwo = await savePlanIn(runEvaluationTransaction, eventId, planInput({ name: "Round 2", round: 2 }));
    for (const planId of [roundOne, roundTwo.planId]) {
      await assignReviewersIn(runEvaluationTransaction, eventId, planId, [{ userId: ada, trackIds: null }]);
    }
    await submitReviewIn(db, eventId, roundOne, platformsTalk, ada, verdict({ overallScore: 2 }));
    await submitReviewIn(db, eventId, roundTwo.planId, platformsTalk, ada, verdict({ overallScore: 5 }));

    expect((await getRatingsIn(db, eventId, roundOne)).get(platformsTalk)?.rating).toBe(2);
    expect((await getRatingsIn(db, eventId, roundTwo.planId)).get(platformsTalk)?.rating).toBe(5);
    const secondRound = await listReviewQueueIn(db, eventId, ada, roundTwo.planId);
    expect(secondRound.rows.find((row) => row.submissionId === platformsTalk)?.myScore).toBe(5);
  });
});
