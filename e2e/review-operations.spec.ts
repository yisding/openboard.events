import { expect, test } from "@playwright/test";
import { apiData, expectNoConsoleErrors, loginAsAdmin } from "./helpers/auth";
import { queryRows } from "./helpers/db";
import { NO_DATABASE, NO_TARGET, databaseConfigured, targetConfigured } from "./helpers/env";
import { EVENTS, FORMS, USERS } from "./helpers/seeded";

/**
 * M50 — review operations, against the deployed preview.
 *
 * The point of running this in a browser rather than in PGlite is the part
 * PGlite cannot see: that the reviewer's *session* is what scopes the queue,
 * that a blind round's HTML never contains the author's name, and that the
 * reminder button writes a row an organizer can then find in the comms log.
 */

const EVENT = EVENTS.main.id;
const EVALUATION = `/events/${EVENT}/evaluation`;
const REVIEW = `/events/${EVENT}/review`;
const API = `/api/internal/evaluation/${EVENT}`;
const REMINDER_ATTEMPT_ID = "c4200000-0000-4000-8009-000000000010";

type PlanDTO = {
  id: string;
  name: string;
  round: number;
  scaleMin: number;
  scaleMax: number;
  status: string;
  trackIds: string[] | null;
  anonymizeAuthors: boolean;
  showPeerScores: boolean;
  opensAt: string | null;
  closesAt: string | null;
  criteria: Array<{
    id: string; label: string; weight: number; kind: string; required: boolean;
    options: Array<{ id: string; label: string; score: number | null }>;
    minValue: number | null; maxValue: number | null;
  }>;
  reviewers: Array<{ userId: string; email: string; assigned: number; completed: number; recused: number }>;
};

type QueueDTO = {
  plan: PlanDTO | null;
  rows: Array<{
    submissionId: string;
    code: number;
    title: string;
    scoredAt: string | null;
    myCriterionValues: Record<string, unknown>;
  }>;
  window: { state: string; canRead: boolean; canSave: boolean } | null;
};

type DetailDTO = {
  submitterName: string | null;
  submitterEmail: string | null;
  speakers: unknown[];
  participants: unknown[];
  answerPanel: { answers: Array<{ fieldId: string; value: { t: string; v: unknown } }> };
};

/**
 * The organizer's own edit of a round, sent as the plan editor sends it: the
 * whole plan, not a patch. Used here to move the window under a reviewer's feet
 * — which is the only honest way to prove a half-open window from outside.
 */
function planUpdate(plan: PlanDTO, window: { opensAt: string | null; closesAt: string | null }) {
  return {
    planId: plan.id,
    name: plan.name,
    round: plan.round,
    scaleMin: plan.scaleMin,
    scaleMax: plan.scaleMax,
    status: plan.status,
    trackIds: plan.trackIds,
    anonymizeAuthors: plan.anonymizeAuthors,
    showPeerScores: plan.showPeerScores,
    criteria: plan.criteria.map((criterion) => ({
      id: criterion.id,
      label: criterion.label,
      weight: criterion.weight,
      kind: criterion.kind,
      required: criterion.required,
      options: criterion.options,
      minValue: criterion.minValue,
      maxValue: criterion.maxValue,
    })),
    ...window,
  };
}

test.describe("review-operations", () => {
  test.skip(!targetConfigured(), NO_TARGET);

  test("an organizer governs a round and a reviewer works exactly their queue", async ({ page, request }) => {
    const assertClean = expectNoConsoleErrors(page);
    await loginAsAdmin(request);

    let round2: PlanDTO;
    await test.step("the seeded rounds carry distinct windows, pools and typed criteria", async () => {
      const { plans } = await apiData<{ plans: PlanDTO[] }>(request, `${API}/plans`);
      expect(plans.length, "the evaluation seed creates two rounds").toBeGreaterThanOrEqual(2);
      const found = plans.find((plan) => plan.round === 2);
      expect(found, "Round 2 is the blind, typed, windowed round").toBeDefined();
      round2 = found as PlanDTO;
      expect(round2.anonymizeAuthors).toBe(true);
      expect(round2.opensAt).not.toBeNull();
      expect(round2.closesAt).not.toBeNull();
      expect(round2.criteria.map((criterion) => criterion.kind)).toEqual(["numeric", "select", "text"]);
      // A configuration that does not survive a reload is not a configuration.
      await loginAsAdmin(page);
      await page.goto(EVALUATION);
      await expect(page.getByText(round2.name)).toBeVisible();
      await expect(page.getByText("Blind review").first()).toBeVisible();
    });

    await test.step("the reviewer sees exactly the submissions assigned to them", async () => {
      // The organizer's copy of the truth, straight from the assignment table.
      const assigned = await queryRows<{ submission_id: string }>(
        `SELECT ra.submission_id FROM review_assignments ra
         JOIN users u ON u.id = ra.reviewer_user_id
         WHERE ra.event_id = $1 AND ra.plan_id = $2 AND u.email = $3 AND ra.status = 'assigned'`,
        [EVENT, round2.id, USERS.reviewer],
      );
      expect(assigned.length, "the seed assigns the reviewer a slice of Round 2").toBeGreaterThan(0);

      await loginAsAdmin(page, USERS.reviewer);
      await page.goto(`${REVIEW}?planId=${round2.id}`);
      const queue = await apiData<QueueDTO>(page.request, `${API}/queue?planId=${round2.id}`);
      expect(queue.window?.state).toBe("open");
      expect(queue.rows.map((row) => row.submissionId).sort())
        .toEqual(assigned.map((row) => row.submission_id).sort());

      // A submission nobody routed to them is refused server-side, not merely
      // hidden: the queue is authorization, and the UI is not.
      const unassigned = await queryRows<{ id: string }>(
        `SELECT s.id FROM submissions s
         WHERE s.event_id = $1 AND s.status NOT IN ('draft','withdrawn')
           AND NOT EXISTS (
             SELECT 1 FROM review_assignments ra JOIN users u ON u.id = ra.reviewer_user_id
             WHERE ra.plan_id = $2 AND ra.submission_id = s.id AND u.email = $3
           )
         LIMIT 1`,
        [EVENT, round2.id, USERS.reviewer],
      );
      if (unassigned[0]) {
        const response = await page.request.get(
          `/api/internal/submissions/${EVENT}/${unassigned[0].id}?planId=${round2.id}`,
        );
        expect([403, 404]).toContain(response.status());
      }
    });

    await test.step("a blind round's payload carries no author identity", async () => {
      const queue = await apiData<QueueDTO>(page.request, `${API}/queue?planId=${round2.id}`);
      const first = queue.rows[0];
      expect(first, "the reviewer needs something to read").toBeDefined();
      const detail = await apiData<DetailDTO>(
        page.request, `/api/internal/submissions/${EVENT}/${first?.submissionId}?planId=${round2.id}`,
      );
      expect(detail.submitterName).toBeNull();
      expect(detail.submitterEmail).toBeNull();
      expect(detail.speakers).toEqual([]);
      expect(detail.participants).toEqual([]);

      // The answer-level half of the same rule, which is where a blind round
      // actually leaks: "Approach" was classified as proposal content, so it
      // survives; "Employer" was left at the fail-closed default, so it does
      // not. Neither decision is taken from the question's name or section.
      const reviewerFields = detail.answerPanel.answers.map((answer) => answer.fieldId);
      expect(reviewerFields).toContain(FORMS.open.fields.approach);
      expect(reviewerFields).not.toContain(FORMS.open.fields.employer);

      // The organizer's copy of the same submission is untouched by any of it.
      const full = await apiData<DetailDTO>(request, `/api/internal/submissions/${EVENT}/${first?.submissionId}`);
      const organizerFields = full.answerPanel.answers.map((answer) => answer.fieldId);
      expect(organizerFields).toEqual(expect.arrayContaining([FORMS.open.fields.approach, FORMS.open.fields.employer]));
      expect(full.submitterEmail).not.toBeNull();
      expect(full.participants.length).toBeGreaterThan(0);

      // And the rendered page, not just the JSON: neither the author's email
      // nor the employer they typed may appear anywhere in the reviewer's HTML.
      const authors = await queryRows<{ email: string }>(
        `SELECT c.email FROM submission_participants sp
         JOIN contacts c ON c.id = sp.contact_id AND c.event_id = sp.event_id
         WHERE sp.event_id = $1 AND sp.submission_id = $2`,
        [EVENT, first?.submissionId],
      );
      const employer = full.answerPanel.answers.find((answer) => answer.fieldId === FORMS.open.fields.employer);
      const html = await page.content();
      for (const author of authors) expect(html).not.toContain(author.email);
      if (typeof employer?.value.v === "string") expect(html).not.toContain(employer.value.v);
    });

    await test.step("a typed scorecard saves and reloads, and required values govern completion", async () => {
      const queue = await apiData<QueueDTO>(page.request, `${API}/queue?planId=${round2.id}`);
      const target = queue.rows[0];
      const [numeric, choice, text] = round2.criteria;
      const scoredOption = choice?.options.find((option) => option.score !== null);
      expect(scoredOption, "the select criterion needs a scored option").toBeDefined();

      // Partial first: saved, but still outstanding and still unrated.
      const partial = await apiData<{ overallScore: number | null; complete: boolean }>(page.request, `${API}/reviews`, {
        method: "POST",
        data: {
          planId: round2.id,
          submissionId: target?.submissionId,
          criterionScores: { [numeric?.id ?? ""]: { kind: "numeric", value: 4 } },
        },
      });
      expect(partial).toMatchObject({ complete: false, overallScore: null });

      const complete = await apiData<{ overallScore: number | null; complete: boolean }>(page.request, `${API}/reviews`, {
        method: "POST",
        data: {
          planId: round2.id,
          submissionId: target?.submissionId,
          criterionScores: {
            [numeric?.id ?? ""]: { kind: "numeric", value: 4 },
            [choice?.id ?? ""]: { kind: "select", optionId: scoredOption?.id },
            [text?.id ?? ""]: { kind: "text", value: "Recorded by the e2e run" },
          },
        },
      });
      expect(complete.complete).toBe(true);
      expect(complete.overallScore).not.toBeNull();

      const reloaded = await apiData<QueueDTO>(page.request, `${API}/queue?planId=${round2.id}`);
      const saved = reloaded.rows.find((row) => row.submissionId === target?.submissionId);
      expect(saved?.scoredAt).not.toBeNull();
      expect(saved?.myCriterionValues[text?.id ?? ""]).toEqual({ kind: "text", value: "Recorded by the e2e run" });
    });

    await test.step("the window governs reading before it opens and saving after it shuts", async () => {
      // The round's own window is moved under the reviewer's feet and put back
      // in a `finally`: a spec that leaves the seeded demo world closed, or not
      // yet open, has broken the thing it was sent to prove.
      const original = { opensAt: round2.opensAt, closesAt: round2.closesAt };
      const saved = await apiData<QueueDTO>(page.request, `${API}/queue?planId=${round2.id}`);
      const target = saved.rows.find((row) => row.scoredAt !== null);
      expect(target, "the previous step's score is what has to stay readable").toBeDefined();
      const setWindow = (window: { opensAt: string | null; closesAt: string | null }) =>
        apiData<PlanDTO>(request, `${API}/plans/${round2.id}`, { method: "PATCH", data: planUpdate(round2, window) });

      try {
        // Before it opens: no content at all, not a greyed-out list. A title is
        // content, so "cannot read before the window" has to mean the payload.
        await setWindow({ opensAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), closesAt: original.closesAt });
        const early = await apiData<QueueDTO>(page.request, `${API}/queue?planId=${round2.id}`);
        expect(early.window).toMatchObject({ state: "before_open", canRead: false, canSave: false });
        expect(early.rows).toEqual([]);
        const earlyDetail = await page.request.get(
          `/api/internal/submissions/${EVENT}/${target?.submissionId}?planId=${round2.id}`,
        );
        expect(earlyDetail.status()).toBe(403);

        // After it shuts: the work stays readable — including the score already
        // saved — and no further save is accepted.
        await setWindow({ opensAt: original.opensAt, closesAt: new Date(Date.now() - 60 * 1000).toISOString() });
        const late = await apiData<QueueDTO>(page.request, `${API}/queue?planId=${round2.id}`);
        expect(late.window).toMatchObject({ state: "closed", canRead: true, canSave: false });
        const stillThere = late.rows.find((row) => row.submissionId === target?.submissionId);
        expect(stillThere?.scoredAt, "prior work survives the close").not.toBeNull();
        const refused = await page.request.post(`${API}/reviews`, {
          data: {
            planId: round2.id,
            submissionId: target?.submissionId,
            criterionScores: { [round2.criteria[0]?.id ?? ""]: { kind: "numeric", value: 2 } },
          },
        });
        expect(refused.status(), "a closed round refuses the save").toBe(409);
      } finally {
        await setWindow(original);
      }

      const reopened = await apiData<QueueDTO>(page.request, `${API}/queue?planId=${round2.id}`);
      expect(reopened.window).toMatchObject({ state: "open", canSave: true });
    });

    await test.step("a recusal leaves the queue and stays on the record", async () => {
      // The organizer hands over one more abstract first, and this step steps
      // away from *that* one. Two reasons, both learned the hard way: recusing
      // the item the previous step scored would take its assignment out of the
      // live set and with it the `completed` count the progress step below
      // asserts on; and recusing a seeded row would shrink the seeded queue on
      // every run, so the second run of the suite — or a single retry — would
      // find nothing left to step away from.
      const [reviewer] = await queryRows<{ id: string }>(
        "SELECT id FROM users WHERE email = $1", [USERS.reviewer],
      );
      expect(reviewer?.id, "the reviewer has to exist before anything can be routed to them").toBeDefined();
      const [spare] = await queryRows<{ id: string }>(
        `SELECT s.id FROM submissions s
         WHERE s.event_id = $1 AND s.status NOT IN ('draft','withdrawn')
           AND NOT EXISTS (
             SELECT 1 FROM review_assignments ra
             WHERE ra.plan_id = $2 AND ra.submission_id = s.id AND ra.reviewer_user_id = $3
           )
         ORDER BY s.code LIMIT 1`,
        [EVENT, round2.id, reviewer?.id],
      );
      expect(spare?.id, "the round needs one unassigned abstract to hand over").toBeDefined();
      const handOver = () => apiData(request, `${API}/plans/${round2.id}/assignments`, {
        method: "PUT",
        data: { reviewerUserIds: [reviewer?.id], submissionIds: [spare?.id], mode: "add" },
      });
      await handOver();

      const queue = await apiData<QueueDTO>(page.request, `${API}/queue?planId=${round2.id}`);
      expect(queue.rows.map((row) => row.submissionId)).toContain(spare?.id);
      await apiData(page.request, `${API}/plans/${round2.id}/recusals`, {
        method: "POST",
        data: { submissionId: spare?.id, reason: "e2e conflict of interest" },
      });

      const after = await apiData<QueueDTO>(page.request, `${API}/queue?planId=${round2.id}`);
      expect(after.rows.map((row) => row.submissionId)).not.toContain(spare?.id);
      const auditRow = () => queryRows<{ status: string; recusal_reason: string; recused_at: string | null }>(
        `SELECT ra.status, ra.recusal_reason, ra.recused_at FROM review_assignments ra
         JOIN users u ON u.id = ra.reviewer_user_id
         WHERE ra.plan_id = $1 AND ra.submission_id = $2 AND u.email = $3`,
        [round2.id, spare?.id, USERS.reviewer],
      );
      const audit = await auditRow();
      expect(audit[0]).toMatchObject({ status: "recused", recusal_reason: "e2e conflict of interest" });
      expect(audit[0]?.recused_at, "a recusal without a time is unauditable").not.toBeNull();

      // Handing the same abstract back does not quietly undo the declaration:
      // the reason and the time are still on the record afterwards.
      await handOver();
      expect((await auditRow())[0]).toMatchObject({ status: "recused", recusal_reason: "e2e conflict of interest" });
      const stillGone = await apiData<QueueDTO>(page.request, `${API}/queue?planId=${round2.id}`);
      expect(stillGone.rows.map((row) => row.submissionId)).not.toContain(spare?.id);
    });

    await test.step("progress and a bulk reminder reach the organizer's own surfaces", async () => {
      await loginAsAdmin(request);
      const { plans } = await apiData<{ plans: PlanDTO[] }>(request, `${API}/plans`);
      const plan = plans.find((entry) => entry.id === round2.id);
      const reviewer = plan?.reviewers.find((entry) => entry.email === USERS.reviewer);
      expect(reviewer?.completed ?? 0).toBeGreaterThan(0);
      expect(reviewer?.recused ?? 0).toBeGreaterThan(0);

      const preview = await apiData<{ reviewers: Array<{ reviewerUserId: string }> }>(request, `${API}/plans/${round2.id}/reminders`);
      const reviewerUserIds = preview.reviewers.map((entry) => entry.reviewerUserId);
      expect(reviewerUserIds.length, "the reminder preview must name its approved audience").toBeGreaterThan(0);
      const result = await apiData<{ enqueued: number; skipped: number }>(request, `${API}/plans/${round2.id}/reminders`, {
        method: "POST",
        data: { reviewerUserIds, attemptId: REMINDER_ATTEMPT_ID },
      });
      const after = Number((await queryRows<{ n: number }>(
        "SELECT count(*)::int AS n FROM communication_logs WHERE event_id = $1 AND template_key = 'review_reminder'",
        [EVENT],
      ))[0]?.n ?? 0);

      // Every reviewer with outstanding work is reminded, and none is skipped:
      // `sendReviewRemindersIn` skips a reviewer with no `contacts` row rather
      // than inventing one, so a non-zero `skipped` means the round holds a
      // reviewer the outbox cannot address — the exact provisioning gap that
      // made this assertion unreachable on the seeded world.
      expect(result.skipped, "a reviewer the outbox cannot address is a provisioning gap, not a pass").toBe(0);
      expect(result.enqueued, "the round still has outstanding reviewers to remind").toBeGreaterThan(0);

      // `>= enqueued`, not `> before`: the stable attempt id makes a Playwright
      // retry re-issue the same key even across a minute boundary, collapsing
      // onto the rows already written. The outbox must hold a reminder for
      // every reviewer this preview approved.
      expect(after, "the enqueued reminders must be in the outbox").toBeGreaterThanOrEqual(result.enqueued);
    });

    assertClean();
  });

  test.describe("without a database the assertions above cannot be made", () => {
    test.skip(databaseConfigured(), NO_DATABASE);
    test("is skipped", () => { expect(databaseConfigured()).toBe(false); });
  });
});
