import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import { getReviewerSubmissionDetailIn, getSubmissionDetailIn } from "@/features/submissions";
import type { PlanId, SubmissionId, UserId } from "@/shared/contracts";
import { seedContacts } from "../../scripts/seed/contacts";
import { seedEvaluation } from "../../scripts/seed/evaluation";
import { seedEvents } from "../../scripts/seed/events";
import { seedForms } from "../../scripts/seed/forms";
import { SEEDED_EMPTY_EVENT_ID, SEEDED_EVENT_ID } from "../../scripts/seed/lib/helpers";
import { seedId } from "../../scripts/seed/lib/ids";
import { seedSubmissions } from "../../scripts/seed/submissions";

/**
 * Every journaled migration, in order. The seed runs the real pipeline across
 * several features, so a hand-picked subset goes stale the moment a
 * neighbouring module adds a column.
 */
const migrationsDir = new URL("../../drizzle/", import.meta.url);
const MIGRATIONS = (JSON.parse(readFileSync(new URL("meta/_journal.json", migrationsDir), "utf8")) as {
  entries: Array<{ idx: number; tag: string }>;
}).entries
  .sort((left, right) => left.idx - right.idx)
  .map((entry) => readFileSync(new URL(`${entry.tag}.sql`, migrationsDir), "utf8"));

const TRACKS = ["agents", "platforms", "security", "community"];

describe("evaluation seed", () => {
  let pglite: PGlite;
  let ctx: { tx: TxDb; now: Date; eventId: typeof SEEDED_EVENT_ID; emptyEventId: typeof SEEDED_EMPTY_EVENT_ID; id: typeof seedId; log: (message: string) => void };
  const logs: string[] = [];

  beforeAll(async () => {
    pglite = new PGlite();
    for (const migration of MIGRATIONS) await pglite.exec(migration);
    await pglite.query(
      "INSERT INTO events(id,name,slug,starts_at,ends_at) VALUES($1,'Seed Event','seed-event','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
      [SEEDED_EVENT_ID],
    );
    for (const [index, key] of TRACKS.entries()) {
      await pglite.query("INSERT INTO tracks(id,event_id,name,color,sort_order) VALUES($1,$2,$3,'#6958d7',$4)", [
        seedId("track", key), SEEDED_EVENT_ID, key, index,
      ]);
    }
    // The third pair of eyes is not decoration: M50's progress screen only has
    // a completed, an outstanding and a recused column to fill because somebody
    // other than the reviewer the deployed spec drives does that work.
    for (const [key, email] of [
      ["organizer", "organizer@openboard.dev"],
      ["reviewer", "reviewer@openboard.dev"],
      ["reviewer2", "reviewer2@openboard.dev"],
    ] as const) {
      await pglite.query("INSERT INTO users(id,email,name) VALUES($1,$2,$3)", [seedId("user", key), email, key]);
      await pglite.query("INSERT INTO event_members(user_id,event_id,role) VALUES($1,$2,$3)", [
        seedId("user", key), SEEDED_EVENT_ID, key === "organizer" ? "owner" : "reviewer",
      ]);
    }
    // Eight abstracts spread over the four tracks, plus a draft and a
    // withdrawal in the reviewer's own tracks — the rows the scope rule must
    // keep out of the queue.
    for (let code = 1; code <= 8; code += 1) {
      await pglite.query(
        "INSERT INTO submissions(id,event_id,code,title,track_id,status,submitted_at) VALUES($1,$2,$3,$4,$5,'pending', now())",
        [seedId("submission", `s${code}`), SEEDED_EVENT_ID, code, `Talk ${code}`, seedId("track", TRACKS[code % 4] ?? "agents")],
      );
    }
    for (const [code, status] of [[9, "draft"], [10, "withdrawn"]] as const) {
      await pglite.query(
        "INSERT INTO submissions(id,event_id,code,title,track_id,status) VALUES($1,$2,$3,$4,$5,$6)",
        [seedId("submission", `s${code}`), SEEDED_EVENT_ID, code, `Talk ${code}`, seedId("track", "agents"), status],
      );
    }

    ctx = {
      tx: drizzle(pglite, { schema }) as unknown as TxDb,
      now: new Date("2026-08-09T12:00:00.000Z"),
      eventId: SEEDED_EVENT_ID,
      emptyEventId: SEEDED_EMPTY_EVENT_ID,
      id: seedId,
      log: (message: string) => logs.push(message),
    };
    await seedEvaluation(ctx);
  }, 60_000);

  afterAll(async () => {
    await pglite.close();
  });

  it("seeds a scored Round 1 and a blind, windowed, typed Round 2", async () => {
    const plans = await pglite.query<{ id: string; name: string; scale_min: number; scale_max: number; status: string; anonymize_authors: boolean; opens_at: string | null; closes_at: string | null }>(
      "SELECT id, name, scale_min, scale_max, status, anonymize_authors, opens_at, closes_at FROM evaluation_plans ORDER BY round",
    );
    expect(plans.rows).toHaveLength(2);
    expect(plans.rows[0]).toMatchObject({ name: "Round 1", scale_min: 1, scale_max: 5, status: "open", anonymize_authors: false });
    // Round 2 is the fixture for M50's own surfaces: a real window and blind
    // review, so a demo can show a round that is governed rather than open-ended.
    expect(plans.rows[1]?.name).toContain("Round 2");
    expect(plans.rows[1]?.anonymize_authors).toBe(true);
    expect(plans.rows[1]?.opens_at).not.toBeNull();
    expect(plans.rows[1]?.closes_at).not.toBeNull();

    const criteria = await pglite.query<{ label: string }>(
      "SELECT label FROM evaluation_criteria WHERE plan_id = $1 ORDER BY sort_order",
      [seedId("plan", "round-1")],
    );
    expect(criteria.rows.map((row) => row.label)).toEqual(["Relevance", "Quality"]);

    const typed = await pglite.query<{ kind: string; required: boolean }>(
      "SELECT kind, required FROM evaluation_criteria WHERE plan_id = $1 ORDER BY sort_order",
      [seedId("plan", "round-2")],
    );
    expect(typed.rows.map((row) => row.kind)).toEqual(["numeric", "select", "text"]);
    expect(typed.rows.at(-1)?.required).toBe(false);
  });

  /**
   * The organizer's progress table has an assigned, a completed, an outstanding
   * and a recused column. A fixture that fills only the first of them is a
   * fixture that cannot show whether the other three are wired to anything.
   */
  it("puts all four assignment states on Round 2, across three reviewers", async () => {
    const rows = await pglite.query<{ email: string; assigned: number; completed: number; recused: number }>(
      `SELECT u.email,
              count(*) FILTER (WHERE ra.status = 'assigned')::int AS assigned,
              count(*) FILTER (WHERE r.submitted_at IS NOT NULL)::int AS completed,
              count(*) FILTER (WHERE ra.status = 'recused')::int AS recused
       FROM review_assignments ra
       JOIN users u ON u.id = ra.reviewer_user_id
       LEFT JOIN reviews r ON r.plan_id = ra.plan_id AND r.submission_id = ra.submission_id
         AND r.reviewer_user_id = ra.reviewer_user_id
       WHERE ra.plan_id = $1 GROUP BY u.email`,
      [seedId("plan", "round-2")],
    );
    const byEmail = new Map(rows.rows.map((row) => [row.email, row]));
    expect([...byEmail.keys()].sort()).toEqual([
      "organizer@openboard.dev", "reviewer2@openboard.dev", "reviewer@openboard.dev",
    ]);
    // The second reviewer carries the finished verdict and the recusal.
    expect(byEmail.get("reviewer2@openboard.dev")).toMatchObject({ completed: 1, recused: 1 });
    expect(byEmail.get("reviewer2@openboard.dev")?.assigned).toBeGreaterThan(0);
    // The reviewer the deployed spec signs in as is left entirely outstanding,
    // so the spec scores its own fixture rather than the seed's leftovers.
    expect(byEmail.get("reviewer@openboard.dev")).toMatchObject({ completed: 0, recused: 0 });
    expect(byEmail.get("reviewer@openboard.dev")?.assigned).toBeGreaterThan(0);

    // And that verdict is a typed one, scored by the server from a numeric value
    // and a *scored* option, with the written note contributing nothing.
    const review = await pglite.query<{ overall_score: string; criterion_scores: Record<string, { kind: string }> }>(
      `SELECT r.overall_score, r.criterion_scores FROM reviews r
       JOIN users u ON u.id = r.reviewer_user_id
       WHERE r.plan_id = $1 AND u.email = 'reviewer2@openboard.dev'`,
      [seedId("plan", "round-2")],
    );
    const values = review.rows[0]?.criterion_scores ?? {};
    expect(Object.values(values).map((value) => value.kind).sort()).toEqual(["numeric", "select", "text"]);
    // (4 × 2 + 4 × 1) / 3 — the text criterion is not in the denominator.
    expect(Number(review.rows[0]?.overall_score)).toBeCloseTo(4, 2);
  });

  it("routes the reviewer to two of the four tracks", async () => {
    const rows = await pglite.query<{ email: string; track_ids: string[] | null }>(
      `SELECT u.email, a.track_ids FROM reviewer_assignments a JOIN users u ON u.id = a.user_id
       WHERE a.plan_id = $1 ORDER BY u.email`,
      [seedId("plan", "round-1")],
    );
    const byEmail = new Map(rows.rows.map((row) => [row.email, row.track_ids]));
    expect([...byEmail.keys()].sort()).toEqual([
      "organizer@openboard.dev", "reviewer2@openboard.dev", "reviewer@openboard.dev",
    ]);
    // The organizer and the second reviewer see everything; the first
    // reviewer's two tracks are the demo's evidence that routing is real.
    expect(byEmail.get("organizer@openboard.dev")).toBeNull();
    expect(byEmail.get("reviewer2@openboard.dev")).toBeNull();
    expect(byEmail.get("reviewer@openboard.dev")).toHaveLength(2);
  });

  it("leaves some abstracts unscored so the Rating column shows an em dash", async () => {
    const rows = await pglite.query<{ scored: number; total: number }>(
      `SELECT (SELECT count(DISTINCT submission_id)::int FROM reviews) AS scored,
              (SELECT count(*)::int FROM submissions WHERE status NOT IN ('draft','withdrawn')) AS total`,
    );
    expect(rows.rows[0]?.scored).toBeGreaterThan(0);
    expect(rows.rows[0]?.scored).toBeLessThan(rows.rows[0]?.total ?? 0);
  });

  it("never scores a draft or a withdrawal, or anything outside the reviewer's tracks", async () => {
    const escaped = await pglite.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM reviews r
       JOIN submissions s ON s.id = r.submission_id
       JOIN reviewer_assignments a ON a.plan_id = r.plan_id AND a.user_id = r.reviewer_user_id
       WHERE s.status IN ('draft','withdrawn')
          OR (a.track_ids IS NOT NULL AND NOT (s.track_id = ANY(a.track_ids)))`,
    );
    expect(escaped.rows[0]?.n).toBe(0);
  });

  it("derives every overall score from the criteria server-side", async () => {
    // M50 stores discriminated values rather than bare numbers, in the same
    // column and the same row — one score store, evolved in place.
    // Round 1 only: its two criteria are both numeric, which is what the
    // weighted mean below is written against. Round 2's typed verdict is
    // checked by the four-states test above, against its own arithmetic.
    const rows = await pglite.query<{ overall_score: string; criterion_scores: Record<string, { kind: string; value: number }> }>(
      "SELECT overall_score, criterion_scores FROM reviews WHERE plan_id = $1",
      [seedId("plan", "round-1")],
    );
    expect(rows.rows.length).toBeGreaterThan(0);
    for (const row of rows.rows) {
      const scores = Object.values(row.criterion_scores);
      expect(scores).toHaveLength(2);
      expect(scores.every((score) => score.kind === "numeric")).toBe(true);
      // Relevance carries twice the weight of Quality.
      const [relevance, quality] = [
        row.criterion_scores[seedId("criterion", "round-1-relevance")]?.value ?? 0,
        row.criterion_scores[seedId("criterion", "round-1-quality")]?.value ?? 0,
      ];
      expect(Number(row.overall_score)).toBeCloseTo(Math.round(((relevance * 2 + quality) / 3) * 100) / 100, 2);
    }
  });

  it("is a no-op on a re-run and preserves organizer changes", async () => {
    const before = await pglite.query<{ n: number }>("SELECT count(*)::int AS n FROM reviews");
    const [first] = (await pglite.query<{ id: string }>("SELECT id FROM reviews ORDER BY submitted_at LIMIT 1")).rows;
    await pglite.query("UPDATE reviews SET overall_score = 1.25 WHERE id = $1", [first?.id]);
    await pglite.query("UPDATE evaluation_plans SET status = 'closed' WHERE id = $1", [seedId("plan", "round-1")]);
    await pglite.query("UPDATE evaluation_criteria SET label = 'Organizer label' WHERE id = $1", [seedId("criterion", "round-1-relevance")]);
    await pglite.query("DELETE FROM reviewer_assignments WHERE user_id = $1 AND plan_id = $2", [
      seedId("user", "organizer"), seedId("plan", "round-1"),
    ]);
    await pglite.query("UPDATE reviewer_assignments SET track_ids = ARRAY[$2]::uuid[] WHERE user_id = $1 AND plan_id = $3", [
      seedId("user", "reviewer"), seedId("track", "security"), seedId("plan", "round-1"),
    ]);

    await seedEvaluation(ctx);

    const after = await pglite.query<{ n: number }>("SELECT count(*)::int AS n FROM reviews");
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
    // A judge who scores during a walkthrough keeps their score.
    const kept = await pglite.query<{ overall_score: string }>("SELECT overall_score FROM reviews WHERE id = $1", [first?.id]);
    expect(Number(kept.rows[0]?.overall_score)).toBe(1.25);
    expect((await pglite.query<{ n: number }>("SELECT count(*)::int AS n FROM evaluation_plans")).rows[0]?.n).toBe(2);
    expect((await pglite.query<{ status: string }>("SELECT status FROM evaluation_plans WHERE id = $1", [
      seedId("plan", "round-1"),
    ])).rows[0]?.status).toBe("closed");
    expect((await pglite.query<{ label: string }>("SELECT label FROM evaluation_criteria WHERE id=$1", [
      seedId("criterion", "round-1-relevance"),
    ])).rows[0]?.label).toBe("Organizer label");
    const assignments = await pglite.query<{ user_id: string; track_ids: string[] | null }>(
      "SELECT user_id,track_ids FROM reviewer_assignments WHERE plan_id = $1 ORDER BY user_id",
      [seedId("plan", "round-1")],
    );
    // The organizer's deletion and the reviewer's narrowed scope both survive;
    // the second reviewer's untouched row is simply still there.
    expect(assignments.rows).toContainEqual({ user_id: seedId("user", "reviewer"), track_ids: [seedId("track", "security")] });
    expect(assignments.rows.map((row) => row.user_id)).not.toContain(seedId("user", "organizer"));
  });

  /**
   * The re-run above is the easy case: both rounds already exist. This is the
   * one that bit — a database seeded before Round 2 existed. Round 1 is present,
   * so the seed used to stop before ever reaching Round 2, and no number of
   * re-runs could produce the blind, windowed, typed round that M50's surfaces
   * and its deployed spec are written against. Short of wiping the database,
   * which is exactly what a seeded preview cannot afford.
   */
  it("adds Round 2 to a database that only ever had Round 1", async () => {
    await pglite.query("DELETE FROM evaluation_plans WHERE id = $1", [seedId("plan", "round-2")]);
    const before = await pglite.query<{ n: number }>("SELECT count(*)::int AS n FROM evaluation_plans");
    expect(before.rows[0]?.n).toBe(1);

    await seedEvaluation(ctx);

    const round2 = await pglite.query<{ anonymize_authors: boolean; opens_at: string | null; closes_at: string | null; status: string }>(
      "SELECT anonymize_authors, opens_at, closes_at, status FROM evaluation_plans WHERE id = $1",
      [seedId("plan", "round-2")],
    );
    expect(round2.rows[0]).toMatchObject({ anonymize_authors: true, status: "open" });
    expect(round2.rows[0]?.opens_at).not.toBeNull();
    expect(round2.rows[0]?.closes_at).not.toBeNull();
    const kinds = await pglite.query<{ kind: string }>(
      "SELECT kind FROM evaluation_criteria WHERE plan_id = $1 ORDER BY sort_order",
      [seedId("plan", "round-2")],
    );
    expect(kinds.rows.map((row) => row.kind)).toEqual(["numeric", "select", "text"]);
    // And a reviewer with an actual worklist: a round nobody is assigned to is
    // a round the spec cannot open.
    const assignments = await pglite.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM review_assignments WHERE plan_id = $1 AND status = 'assigned'",
      [seedId("plan", "round-2")],
    );
    expect(assignments.rows[0]?.n).toBeGreaterThan(0);
    // Round 1's own state is untouched by the top-up — the organizer's `closed`
    // status from the re-run test above is still there.
    expect((await pglite.query<{ status: string }>("SELECT status FROM evaluation_plans WHERE id = $1", [
      seedId("plan", "round-1"),
    ])).rows[0]?.status).toBe("closed");
  });

  /**
   * The other half of the same failure, and the one an existence-only guard
   * still had: a database that carries Round 2 in the shape it had *before* the
   * three-reviewer fixture — two reviewers, nobody finished, nobody stepped
   * away. "The plan row is there, therefore the round is right" skipped it
   * wholesale, so the organizer's progress table would have shown an assigned
   * column and three empty ones on the very database the walkthrough runs on,
   * however many times the seed was re-run.
   */
  it("tops up a Round 2 that predates the three-reviewer fixture", async () => {
    const planId = seedId("plan", "round-2");
    const organizer = seedId("user", "organizer");
    await pglite.query("DELETE FROM reviews WHERE plan_id = $1", [planId]);
    await pglite.query(
      "UPDATE review_assignments SET status = 'assigned', recusal_reason = NULL, recused_at = NULL WHERE plan_id = $1",
      [planId],
    );
    await pglite.query("DELETE FROM review_assignments WHERE plan_id = $1 AND reviewer_user_id = $2", [planId, organizer]);
    await pglite.query("DELETE FROM reviewer_assignments WHERE plan_id = $1 AND user_id = $2", [planId, organizer]);
    const before = await pglite.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM reviewer_assignments WHERE plan_id = $1", [planId],
    );
    expect(before.rows[0]?.n).toBe(2);

    await seedEvaluation(ctx);

    const rows = await pglite.query<{ email: string; assigned: number; completed: number; recused: number }>(
      `SELECT u.email,
              count(*) FILTER (WHERE ra.status = 'assigned')::int AS assigned,
              count(*) FILTER (WHERE r.submitted_at IS NOT NULL)::int AS completed,
              count(*) FILTER (WHERE ra.status = 'recused')::int AS recused
       FROM review_assignments ra
       JOIN users u ON u.id = ra.reviewer_user_id
       LEFT JOIN reviews r ON r.plan_id = ra.plan_id AND r.submission_id = ra.submission_id
         AND r.reviewer_user_id = ra.reviewer_user_id
       WHERE ra.plan_id = $1 GROUP BY u.email`,
      [planId],
    );
    const byEmail = new Map(rows.rows.map((row) => [row.email, row]));
    expect([...byEmail.keys()].sort()).toEqual([
      "organizer@openboard.dev", "reviewer2@openboard.dev", "reviewer@openboard.dev",
    ]);
    expect(byEmail.get("reviewer2@openboard.dev")).toMatchObject({ completed: 1, recused: 1 });
    expect(byEmail.get("reviewer@openboard.dev")).toMatchObject({ completed: 0, recused: 0 });
    expect(byEmail.get("organizer@openboard.dev")?.assigned).toBeGreaterThan(0);
    // The round itself is not rewritten by a top-up: it is still the blind,
    // windowed one the organizer has, and the top-up adds rows to it.
    expect((await pglite.query<{ anonymize_authors: boolean }>(
      "SELECT anonymize_authors FROM evaluation_plans WHERE id = $1", [planId],
    )).rows[0]?.anonymize_authors).toBe(true);

    // And now that the fixture is there, the round is the organizer's again: a
    // reviewer they take off it does not come back on the next re-run.
    await pglite.query("DELETE FROM review_assignments WHERE plan_id = $1 AND reviewer_user_id = $2", [planId, organizer]);
    await pglite.query("DELETE FROM reviewer_assignments WHERE plan_id = $1 AND user_id = $2", [planId, organizer]);
    await seedEvaluation(ctx);
    expect((await pglite.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM reviewer_assignments WHERE plan_id = $1 AND user_id = $2", [planId, organizer],
    )).rows[0]?.n).toBe(0);
  });

  it("scores submissions created by the real seed pipeline", async () => {
    const seededDb = new PGlite();
    try {
      for (const migration of MIGRATIONS) await seededDb.exec(migration);
      const seededCtx = {
        ...ctx,
        tx: drizzle(seededDb, { schema }) as unknown as TxDb,
        log: () => undefined,
      };
      await seedEvents(seededCtx);
      await seedContacts(seededCtx);
      await seedForms(seededCtx);
      await seedSubmissions(seededCtx);
      await seedEvaluation(seededCtx);

      const routed = await seededDb.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM submissions
         WHERE client_session_id LIKE 'seed:submission:%' AND track_id IS NOT NULL AND format_id IS NOT NULL`,
      );
      const reviews = await seededDb.query<{ n: number }>("SELECT count(*)::int AS n FROM reviews");
      expect(routed.rows[0]?.n).toBeGreaterThan(0);
      expect(reviews.rows[0]?.n).toBeGreaterThan(0);

      // The demo world's blind round, read the way a reviewer's browser reads
      // it: the seeded "Approach" question is classified as proposal content
      // and survives, the seeded "Employer" question was left at the
      // fail-closed default and does not — and the organizer, who is not blind,
      // still has both. Asserting this on the *seed* rather than on a
      // purpose-built form is the point: the fixture the deployed spec runs
      // against is the one that has to be blind.
      const [assignment] = (await seededDb.query<{ submission_id: string }>(
        `SELECT submission_id FROM review_assignments
         WHERE plan_id = $1 AND reviewer_user_id = $2 AND status = 'assigned' ORDER BY submission_id LIMIT 1`,
        [seedId("plan", "round-2"), seedId("user", "reviewer")],
      )).rows;
      expect(assignment?.submission_id).toBeDefined();
      const submissionId = assignment?.submission_id as SubmissionId;
      const blind = await getReviewerSubmissionDetailIn(
        seededCtx.tx, SEEDED_EVENT_ID, seedId("plan", "round-2") as PlanId, submissionId,
        seedId("user", "reviewer") as UserId, ctx.now,
      );
      const organizer = await getSubmissionDetailIn(seededCtx.tx, SEEDED_EVENT_ID, submissionId);
      const fieldIds = (detail: typeof blind) => detail.answerPanel.answers.map((answer) => answer.fieldId as string);
      const approach = seedId("field", "form-a-approach");
      const employer = seedId("field", "form-a-employer");

      expect(fieldIds(blind)).toContain(approach);
      expect(fieldIds(blind)).not.toContain(employer);
      expect(fieldIds(organizer)).toEqual(expect.arrayContaining([approach, employer]));
      // And no route between the two can put a name back on it.
      expect(blind.submitterName).toBeNull();
      expect(blind.participants).toEqual([]);
      expect(organizer.participants.length).toBeGreaterThan(0);

      // And the same fixture on a database seeded *before* those two questions
      // existed, which is every already-seeded preview: the submission seed
      // skips a row it already created, so the answers have to be topped up or
      // only a full wipe would ever produce them.
      const countAnswers = async () => Number((await seededDb.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM submission_answers WHERE field_id = ANY($1::uuid[])",
        [[approach, employer]],
      )).rows[0]?.n ?? 0);
      const fresh = await countAnswers();
      expect(fresh).toBeGreaterThan(0);

      await seededDb.query("DELETE FROM submission_answers WHERE field_id = ANY($1::uuid[])", [[approach, employer]]);
      await seedSubmissions(seededCtx);
      expect(await countAnswers()).toBe(fresh);
      // Idempotent: a second re-run neither duplicates nor rewrites them.
      await seedSubmissions(seededCtx);
      expect(await countAnswers()).toBe(fresh);
    } finally {
      await seededDb.close();
    }
  }, 60_000);
});
