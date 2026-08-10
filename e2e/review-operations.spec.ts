import { expect, test } from "@playwright/test";
import { apiData, expectNoConsoleErrors, loginAsAdmin } from "./helpers/auth";
import { queryRows } from "./helpers/db";
import { NO_DATABASE, NO_TARGET, databaseConfigured, targetConfigured } from "./helpers/env";
import { landed, waitingOn } from "./helpers/landed";
import { EVENTS, USERS } from "./helpers/seeded";

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

type PlanDTO = {
  id: string;
  name: string;
  round: number;
  anonymizeAuthors: boolean;
  opensAt: string | null;
  closesAt: string | null;
  criteria: Array<{ id: string; label: string; kind: string; required: boolean; options: Array<{ id: string; score: number | null }> }>;
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
  window: { state: string; canSave: boolean } | null;
};

test.describe("review-operations", () => {
  test.skip(!targetConfigured(), NO_TARGET);
  test.skip(!landed("M50"), waitingOn("M50"));

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
      const detail = await apiData<{
        submitterName: string | null;
        submitterEmail: string | null;
        speakers: unknown[];
        participants: unknown[];
      }>(page.request, `/api/internal/submissions/${EVENT}/${first?.submissionId}?planId=${round2.id}`);
      expect(detail.submitterName).toBeNull();
      expect(detail.submitterEmail).toBeNull();
      expect(detail.speakers).toEqual([]);
      expect(detail.participants).toEqual([]);

      // And the rendered page, not just the JSON: the author's email must not
      // appear anywhere in the reviewer's HTML.
      const authors = await queryRows<{ email: string }>(
        `SELECT c.email FROM submission_participants sp
         JOIN contacts c ON c.id = sp.contact_id AND c.event_id = sp.event_id
         WHERE sp.event_id = $1 AND sp.submission_id = $2`,
        [EVENT, first?.submissionId],
      );
      const html = await page.content();
      for (const author of authors) expect(html).not.toContain(author.email);
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

    await test.step("a recusal leaves the queue and stays on the record", async () => {
      const queue = await apiData<QueueDTO>(page.request, `${API}/queue?planId=${round2.id}`);
      const target = queue.rows.at(-1);
      expect(target, "the reviewer needs a second item to step away from").toBeDefined();
      await apiData(page.request, `${API}/plans/${round2.id}/recusals`, {
        method: "POST",
        data: { submissionId: target?.submissionId, reason: "e2e conflict of interest" },
      });

      const after = await apiData<QueueDTO>(page.request, `${API}/queue?planId=${round2.id}`);
      expect(after.rows.map((row) => row.submissionId)).not.toContain(target?.submissionId);
      const audit = await queryRows<{ status: string; recusal_reason: string }>(
        `SELECT ra.status, ra.recusal_reason FROM review_assignments ra
         JOIN users u ON u.id = ra.reviewer_user_id
         WHERE ra.plan_id = $1 AND ra.submission_id = $2 AND u.email = $3`,
        [round2.id, target?.submissionId, USERS.reviewer],
      );
      expect(audit[0]).toMatchObject({ status: "recused", recusal_reason: "e2e conflict of interest" });
    });

    await test.step("progress and a bulk reminder reach the organizer's own surfaces", async () => {
      await loginAsAdmin(request);
      const { plans } = await apiData<{ plans: PlanDTO[] }>(request, `${API}/plans`);
      const plan = plans.find((entry) => entry.id === round2.id);
      const reviewer = plan?.reviewers.find((entry) => entry.email === USERS.reviewer);
      expect(reviewer?.completed ?? 0).toBeGreaterThan(0);
      expect(reviewer?.recused ?? 0).toBeGreaterThan(0);

      const before = await queryRows<{ n: number }>(
        "SELECT count(*)::int AS n FROM communication_logs WHERE event_id = $1 AND template_key = 'review_reminder'",
        [EVENT],
      );
      await apiData<{ enqueued: number; skipped: number }>(request, `${API}/plans/${round2.id}/reminders`, {
        method: "POST",
        data: { reviewerUserIds: null },
      });
      const after = await queryRows<{ n: number }>(
        "SELECT count(*)::int AS n FROM communication_logs WHERE event_id = $1 AND template_key = 'review_reminder'",
        [EVENT],
      );
      expect(Number(after[0]?.n ?? 0)).toBeGreaterThan(Number(before[0]?.n ?? 0));
    });

    assertClean();
  });

  test.describe("without a database the assertions above cannot be made", () => {
    test.skip(databaseConfigured(), NO_DATABASE);
    test("is skipped", () => { expect(databaseConfigured()).toBe(false); });
  });
});
