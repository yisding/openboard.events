import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migration0 = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");
const migration28 = readFileSync(new URL("../../drizzle/0028_submission_status_history.sql", import.meta.url), "utf8");

describe("submission status history migration", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(migration0);
    await db.exec(migration1);
    await db.exec(`
      INSERT INTO events(id,name,slug,starts_at,ends_at)
      VALUES('f2800000-0000-4000-8000-000000000001','Existing event','decision-history','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z');
      INSERT INTO users(id,email,name)
      VALUES('f2800000-0000-4000-8000-000000000002','organizer@example.com','Olive Organizer');
      INSERT INTO contacts(id,event_id,email,first_name,last_name)
      VALUES('f2800000-0000-4000-8000-000000000003','f2800000-0000-4000-8000-000000000001','speaker@example.com','Sam','Speaker');
      INSERT INTO submissions(id,event_id,code,status,title,submitter_contact_id,updated_at)
      VALUES(
        'f2800000-0000-4000-8000-000000000004',
        'f2800000-0000-4000-8000-000000000001',
        1,
        'accepted',
        'Existing proposal',
        'f2800000-0000-4000-8000-000000000003',
        '2026-08-10T10:00:00Z'
      );
    `);
    await db.exec(migration28);
  });

  afterAll(async () => db.close());

  it("backfills an honest baseline and preserves transitions after actors are removed", async () => {
    const baseline = await db.query<{
      from_status: string | null;
      to_status: string;
      source: string;
      changed_at: Date;
    }>("SELECT from_status, to_status, source, changed_at FROM submission_status_revisions");
    expect(baseline.rows).toHaveLength(1);
    expect(baseline.rows[0]).toMatchObject({ from_status: null, to_status: "accepted", source: "baseline" });
    expect(new Date(baseline.rows[0]?.changed_at ?? 0).toISOString()).toBe("2026-08-10T10:00:00.000Z");

    await db.exec(`
      WITH audit_context AS (
        SELECT
          set_config('openboard.submission_status_source', 'organizer', true),
          set_config('openboard.actor_user_id', 'f2800000-0000-4000-8000-000000000002', true),
          set_config('openboard.actor_contact_id', '', true)
      )
      UPDATE submissions SET status='pending'
      FROM audit_context
      WHERE id='f2800000-0000-4000-8000-000000000004';
    `);
    await db.exec(`
      WITH audit_context AS (
        SELECT
          set_config('openboard.submission_status_source', 'speaker', true),
          set_config('openboard.actor_user_id', '', true),
          set_config('openboard.actor_contact_id', 'f2800000-0000-4000-8000-000000000003', true)
      )
      UPDATE submissions SET status='withdrawn'
      FROM audit_context
      WHERE id='f2800000-0000-4000-8000-000000000004';
    `);

    const changes = await db.query<{
      from_status: string | null;
      to_status: string;
      source: string;
      actor_user_id: string | null;
      actor_contact_id: string | null;
    }>("SELECT from_status, to_status, source, actor_user_id, actor_contact_id FROM submission_status_revisions ORDER BY changed_at, id");
    expect(changes.rows.slice(1)).toEqual([
      expect.objectContaining({
        from_status: "accepted",
        to_status: "pending",
        source: "organizer",
        actor_user_id: "f2800000-0000-4000-8000-000000000002",
      }),
      expect.objectContaining({
        from_status: "pending",
        to_status: "withdrawn",
        source: "speaker",
        actor_contact_id: "f2800000-0000-4000-8000-000000000003",
      }),
    ]);

    await db.exec("DELETE FROM users WHERE id='f2800000-0000-4000-8000-000000000002'");
    await db.exec("DELETE FROM contacts WHERE id='f2800000-0000-4000-8000-000000000003'");
    const retained = await db.query<{ n: number; user_refs: number; contact_refs: number }>(`
      SELECT count(*)::int AS n,
        count(actor_user_id)::int AS user_refs,
        count(actor_contact_id)::int AS contact_refs
      FROM submission_status_revisions
    `);
    expect(retained.rows[0]).toEqual({ n: 3, user_refs: 0, contact_refs: 0 });
  });
});
