import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TxDb } from "@/db/client";
import * as schema from "@/db/schema";
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
    for (const [key, email] of [["organizer", "organizer@openboard.dev"], ["reviewer", "reviewer@openboard.dev"]] as const) {
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

  it("routes the reviewer to two of the four tracks", async () => {
    const rows = await pglite.query<{ email: string; track_ids: string[] | null }>(
      `SELECT u.email, a.track_ids FROM reviewer_assignments a JOIN users u ON u.id = a.user_id
       WHERE a.plan_id = $1 ORDER BY u.email`,
      [seedId("plan", "round-1")],
    );
    expect(rows.rows.map((row) => row.email)).toEqual(["organizer@openboard.dev", "reviewer@openboard.dev"]);
    // The organizer sees everything; the reviewer's two tracks are the demo's
    // evidence that routing is real.
    expect(rows.rows[0]?.track_ids).toBeNull();
    expect(rows.rows[1]?.track_ids).toHaveLength(2);
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
    const rows = await pglite.query<{ overall_score: string; criterion_scores: Record<string, { kind: string; value: number }> }>(
      "SELECT overall_score, criterion_scores FROM reviews",
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
    expect(assignments.rows).toEqual([{ user_id: seedId("user", "reviewer"), track_ids: [seedId("track", "security")] }]);
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
    } finally {
      await seededDb.close();
    }
  }, 60_000);
});
