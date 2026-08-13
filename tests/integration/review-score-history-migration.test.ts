import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migration0 = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");
const migration4 = readFileSync(new URL("../../drizzle/0004_review_operations.sql", import.meta.url), "utf8");
const migration26 = readFileSync(new URL("../../drizzle/0026_independent_review_scoring.sql", import.meta.url), "utf8");
const migration27 = readFileSync(new URL("../../drizzle/0027_review_score_history.sql", import.meta.url), "utf8");

describe("review score history migration", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(migration0);
    await db.exec(migration1);
    await db.exec(migration4);
    await db.exec(migration26);
    await db.exec(`
      INSERT INTO events(id,name,slug,starts_at,ends_at)
      VALUES('f2700000-0000-4000-8000-000000000001','Existing event','review-history','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z');
      INSERT INTO users(id,email,name)
      VALUES('f2700000-0000-4000-8000-000000000002','reviewer@example.com','Existing Reviewer');
      INSERT INTO submissions(id,event_id,code,status,title)
      VALUES('f2700000-0000-4000-8000-000000000003','f2700000-0000-4000-8000-000000000001',1,'pending','Existing proposal');
      INSERT INTO evaluation_plans(id,event_id,name)
      VALUES('f2700000-0000-4000-8000-000000000004','f2700000-0000-4000-8000-000000000001','Existing round');
      INSERT INTO evaluation_criteria(id,event_id,plan_id,label,options)
      VALUES(
        'f2700000-0000-4000-8000-000000000005',
        'f2700000-0000-4000-8000-000000000001',
        'f2700000-0000-4000-8000-000000000004',
        'Original label',
        '[]'::jsonb
      );
      INSERT INTO reviews(
        id,event_id,plan_id,submission_id,reviewer_user_id,
        overall_score,criterion_scores,comment,submitted_at,updated_at
      ) VALUES(
        'f2700000-0000-4000-8000-000000000006',
        'f2700000-0000-4000-8000-000000000001',
        'f2700000-0000-4000-8000-000000000004',
        'f2700000-0000-4000-8000-000000000003',
        'f2700000-0000-4000-8000-000000000002',
        3,
        '{"f2700000-0000-4000-8000-000000000005":{"kind":"numeric","value":3}}'::jsonb,
        'Original verdict',
        '2026-08-10T10:00:00Z',
        '2026-08-10T10:00:00Z'
      );
    `);
    await db.exec(migration27);
  });

  afterAll(async () => db.close());

  it("backfills current reviews and captures only meaningful later edits", async () => {
    const initial = await db.query<{
      revision: number;
      overall_score: string;
      comment: string;
      criteria_snapshot: Array<{ label: string }>;
      recorded_at: Date;
    }>("SELECT revision, overall_score, comment, criteria_snapshot, recorded_at FROM review_revisions");
    expect(initial.rows).toHaveLength(1);
    expect(initial.rows[0]).toMatchObject({
      revision: 1,
      overall_score: "3",
      comment: "Original verdict",
      criteria_snapshot: [{ label: "Original label" }],
    });
    expect(new Date(initial.rows[0]?.recorded_at ?? 0).toISOString()).toBe("2026-08-10T10:00:00.000Z");

    // An UPDATE that carries exactly the current verdict is not a revision.
    await db.exec("UPDATE reviews SET overall_score=3, comment='Original verdict' WHERE id='f2700000-0000-4000-8000-000000000006'");
    expect((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM review_revisions")).rows[0]?.n).toBe(1);

    await db.exec(`
      UPDATE evaluation_criteria SET label='Renamed criterion'
      WHERE id='f2700000-0000-4000-8000-000000000005';
      UPDATE reviews SET
        overall_score=5,
        criterion_scores='{"f2700000-0000-4000-8000-000000000005":{"kind":"numeric","value":5}}'::jsonb,
        comment='Revised verdict',
        submitted_at='2026-08-11T10:00:00Z'
      WHERE id='f2700000-0000-4000-8000-000000000006';
    `);
    const revisions = await db.query<{ revision: number; overall_score: string; criteria_snapshot: Array<{ label: string }> }>(
      "SELECT revision, overall_score, criteria_snapshot FROM review_revisions ORDER BY revision",
    );
    expect(revisions.rows).toEqual([
      expect.objectContaining({
        revision: 1,
        overall_score: "3",
        criteria_snapshot: [expect.objectContaining({ label: "Original label" })],
      }),
      expect.objectContaining({
        revision: 2,
        overall_score: "5",
        criteria_snapshot: [expect.objectContaining({ label: "Renamed criterion" })],
      }),
    ]);
  });
});
