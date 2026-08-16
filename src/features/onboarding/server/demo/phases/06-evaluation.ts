import { eventMembers } from "@/db/schema";
import { listOrganizationMembersIn } from "@/features/organizations";
import { assignReviewersIn, assignSubmissionsIn, isScorableStatus, savePlanIn, type PlanWrite } from "@/features/submissions";
import { planIdSchema, type UserId } from "@/shared/contracts";
import { SUBMISSIONS } from "../dataset";
import { demoId } from "../ids";
import type { PhaseCtx } from "./context";
import { readDemoSubmissionIdsIn } from "./lookup";

/**
 * Phase 6 — the review queue Chapter 4 hands the organizer.
 *
 * Two rounds, and the whole point is what they do *not* contain: no synthetic
 * `users` row, and no pre-scored review (design D6). Round 1 is real,
 * unfinished work assigned to the signed-in organizer — six proposals, zero
 * verdicts — so the aggregate Chapter 4 shows off is one the player caused
 * 100% of, not a number product-ux would have had to fabricate. Round 2 exists
 * to be blind, scheduled and empty: Q3's whole payload.
 *
 * `assignReviewersIn` and `assignSubmissionsIn` both take a *transaction
 * runner* (`EvaluationTransaction`), not a bare `DbOrTx` — the one place in
 * phases 6–10 that genuinely needs `ctx.inTransaction` rather than
 * `ctx.dbOrTx` directly. Everything else these ten phases call (`saveSessionIn`,
 * `promoteSubmissionIn`, `createTaskIn`, `createFileRequestIn`,
 * `createResourcePageIn`) is typed against `DbOrTx` and runs its own atomic
 * statement, contra design §2.3's claim that phases 4–8 uniformly "require a
 * TxDb" — verified false for everything here except this phase's evaluation
 * writers (and phases 4/5's `createSubmissionIn`, already WP4's).
 */

/**
 * The same three criteria both rounds score against — a program committee
 * re-judging the same rubric blind is a different exercise than judging a
 * different one. `id: null` lets `savePlanIn` derive each criterion's id from
 * its own plan id (`stableUuid(planId, "criterion:" + index)`), which is what
 * keeps a replay converging on the same three rows instead of proposing a
 * fourth every time this phase re-runs.
 */
const CRITERIA: PlanWrite["criteria"] = [
  { id: null, label: "Technical depth", weight: 2, kind: "numeric", required: true, options: [], minValue: null, maxValue: null },
  { id: null, label: "Speaker readiness", weight: 1, kind: "numeric", required: true, options: [], minValue: null, maxValue: null },
  { id: null, label: "Audience fit", weight: 1, kind: "numeric", required: true, options: [], minValue: null, maxValue: null },
];

/** Six real, unscored assignments for the organizer; two more for anybody
 *  else already on the organization, taken from the dataset's own submitted
 *  order so a replay always proposes the identical set. */
const ROUND_ONE_COUNT = 6;
const BONUS_COUNT = 2;

export async function runEvaluationPhase(ctx: PhaseCtx): Promise<void> {
  const { dbOrTx, inTransaction, eventId, organizationId, actorUserId, dates } = ctx;

  const scorable = SUBMISSIONS.filter((submission) => isScorableStatus(submission.status));
  const round1Keys = scorable.slice(0, ROUND_ONE_COUNT).map((submission) => submission.key);
  const bonusKeys = scorable.slice(ROUND_ONE_COUNT, ROUND_ONE_COUNT + BONUS_COUNT).map((submission) => submission.key);
  const submissionIds = await readDemoSubmissionIdsIn(dbOrTx, eventId, [...round1Keys, ...bonusKeys]);

  const round1Id = planIdSchema.parse(demoId(eventId, "plan:round1"));
  const round2Id = planIdSchema.parse(demoId(eventId, "plan:round2"));

  await savePlanIn(inTransaction, eventId, {
    planId: round1Id,
    name: "First pass",
    round: 1,
    scaleMin: 1,
    scaleMax: 5,
    status: "open",
    trackIds: null,
    opensAt: null,
    closesAt: null,
    anonymizeAuthors: false,
    showPeerScores: false,
    criteria: CRITERIA,
  });

  await savePlanIn(inTransaction, eventId, {
    planId: round2Id,
    name: "Program committee",
    round: 2,
    scaleMin: 1,
    scaleMax: 5,
    status: "open",
    trackIds: null,
    // "Scheduled" (design §2.4): the round exists and is blind, but its window
    // has not opened yet. Tying it to the CFP's own close means Round 2 always
    // opens the moment there is nothing left to submit, whatever `now` sampled.
    opensAt: dates.forms.cfp.closesAt.toISOString(),
    closesAt: null,
    anonymizeAuthors: true,
    showPeerScores: false,
    criteria: CRITERIA,
  });

  // Bonus reviewers: any other organization member gets two real assignments
  // of their own. `assignReviewersIn` treats its whole reviewer list as the
  // round's complete roster — a second call with a different set would delete
  // the first (verified: `evaluation/server/mutations.ts`'s `removed` CTE), so
  // the organizer and every bonus reviewer are registered in one call.
  const others = (await listOrganizationMembersIn(dbOrTx, organizationId))
    .map((member) => member.userId)
    .filter((userId): userId is UserId => userId !== actorUserId);

  if (others.length > 0) {
    // `assignReviewersIn` only accepts reviewers who are already members of
    // *this event*, not merely the organization — a demo event starts with
    // just its owner (design §2.4's "owner event_members"). Provisioning has
    // to grant that access itself before it can hand out real work.
    //
    // `reviewer`, never `organizer`. This is the one place in the product
    // where event access is minted as a side effect of somebody *else*
    // pressing a button, so it grants the weakest role that can hold a
    // round-one assignment. An `organizer` row here would hand every
    // organization member — including the org-level `reviewer`s that
    // `inviteEventReviewerIn` creates, who cannot even list the organization's
    // members — the demo event's full organizer surface, and with it
    // `listEventMembersIn`'s name/email directory of the whole organization.
    // Design §2.4 asks for review assignments, not access.
    //
    // `onConflictDoNothing` rather than an upsert: a co-organizer who already
    // holds a stronger role on this event keeps it. Nobody is demoted, and
    // nobody is promoted.
    await dbOrTx.insert(eventMembers)
      .values(others.map((userId) => ({ userId, eventId, role: "reviewer" as const })))
      .onConflictDoNothing({ target: [eventMembers.userId, eventMembers.eventId] });
  }

  await assignReviewersIn(inTransaction, eventId, round1Id, [
    { userId: actorUserId, trackIds: null },
    ...others.map((userId) => ({ userId, trackIds: null })),
  ]);

  // `assignReviewersIn` itself already materializes a `review_assignments` row
  // for every scorable submission in the round's scope the moment a reviewer
  // is registered (verified: its own `materialized` CTE, keyed off the
  // reviewer's *candidate* track scope, not a hand-picked list) — with
  // `trackIds: null` that is every scorable submission in the event, not six.
  // `mode: "replace"` is what trims each reviewer's queue down to exactly the
  // submissions this phase intends, by deleting the rest of that automatic
  // grant; `"add"` would have left all twenty-one standing.
  const round1SubmissionIds = round1Keys.flatMap((key) => { const id = submissionIds.get(key); return id ? [id] : []; });
  if (round1SubmissionIds.length > 0) {
    await assignSubmissionsIn(inTransaction, eventId, {
      planId: round1Id, reviewerUserIds: [actorUserId], submissionIds: round1SubmissionIds, mode: "replace",
    });
  }

  const bonusSubmissionIds = bonusKeys.flatMap((key) => { const id = submissionIds.get(key); return id ? [id] : []; });
  if (others.length > 0 && bonusSubmissionIds.length > 0) {
    await assignSubmissionsIn(inTransaction, eventId, {
      planId: round1Id, reviewerUserIds: others, submissionIds: bonusSubmissionIds, mode: "replace",
    });
  }
}
