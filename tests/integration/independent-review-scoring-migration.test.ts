import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migration0 = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");
const migration4 = readFileSync(new URL("../../drizzle/0004_review_operations.sql", import.meta.url), "utf8");
const migration26 = readFileSync(new URL("../../drizzle/0026_independent_review_scoring.sql", import.meta.url), "utf8");

describe("independent review scoring migration", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(migration0);
    await db.exec(migration1);
    await db.exec(migration4);
    await db.exec(`
      INSERT INTO events(id,name,slug,starts_at,ends_at)
      VALUES('f2600000-0000-4000-8000-000000000001','Existing event','existing-event','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z');
      INSERT INTO evaluation_plans(id,event_id,name)
      VALUES('f2600000-0000-4000-8000-000000000002','f2600000-0000-4000-8000-000000000001','Existing round');
    `);
    await db.exec(migration26);
  });

  afterAll(async () => db.close());

  it("preserves sharing for existing rounds and defaults new rounds to independent scoring", async () => {
    await db.exec(`
      INSERT INTO evaluation_plans(id,event_id,name)
      VALUES('f2600000-0000-4000-8000-000000000003','f2600000-0000-4000-8000-000000000001','New round');
    `);
    const result = await db.query<{ name: string; show_peer_scores: boolean }>(
      "SELECT name, show_peer_scores FROM evaluation_plans ORDER BY name",
    );
    expect(result.rows).toEqual([
      { name: "Existing round", show_peer_scores: true },
      { name: "New round", show_peer_scores: false },
    ]);
  });
});
