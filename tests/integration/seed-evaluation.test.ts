import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import { seedEvaluation } from "../../scripts/seed/evaluation";
import { SEEDED_EMPTY_EVENT_ID, SEEDED_EVENT_ID } from "../../scripts/seed/lib/helpers";
import { seedId } from "../../scripts/seed/lib/ids";

const migration0 = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");

const TRACKS = ["agents", "platforms", "security", "community"];

describe("evaluation seed", () => {
  let pglite: PGlite;
  let ctx: { tx: TxDb; now: Date; eventId: typeof SEEDED_EVENT_ID; emptyEventId: typeof SEEDED_EMPTY_EVENT_ID; id: typeof seedId; log: (message: string) => void };
  const logs: string[] = [];

  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migration0);
    await pglite.exec(migration1);
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

  it("seeds one open round with its criteria", async () => {
    const plans = await pglite.query<{ id: string; name: string; scale_min: number; scale_max: number; status: string }>(
      "SELECT id, name, scale_min, scale_max, status FROM evaluation_plans",
    );
    expect(plans.rows).toHaveLength(1);
    expect(plans.rows[0]).toMatchObject({ name: "Round 1", scale_min: 1, scale_max: 5, status: "open" });

    const criteria = await pglite.query<{ label: string }>("SELECT label FROM evaluation_criteria ORDER BY sort_order");
    expect(criteria.rows.map((row) => row.label)).toEqual(["Relevance", "Quality"]);
  });

  it("routes the reviewer to two of the four tracks", async () => {
    const rows = await pglite.query<{ email: string; track_ids: string[] | null }>(
      `SELECT u.email, a.track_ids FROM reviewer_assignments a JOIN users u ON u.id = a.user_id ORDER BY u.email`,
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
    const rows = await pglite.query<{ overall_score: string; criterion_scores: Record<string, number> }>(
      "SELECT overall_score, criterion_scores FROM reviews",
    );
    expect(rows.rows.length).toBeGreaterThan(0);
    for (const row of rows.rows) {
      const scores = Object.values(row.criterion_scores);
      expect(scores).toHaveLength(2);
      // Relevance carries twice the weight of Quality.
      const [relevance, quality] = [
        row.criterion_scores[seedId("criterion", "round-1-relevance")] ?? 0,
        row.criterion_scores[seedId("criterion", "round-1-quality")] ?? 0,
      ];
      expect(Number(row.overall_score)).toBeCloseTo(Math.round(((relevance * 2 + quality) / 3) * 100) / 100, 2);
    }
  });

  it("is a no-op on a re-run and keeps a score given in between", async () => {
    const before = await pglite.query<{ n: number }>("SELECT count(*)::int AS n FROM reviews");
    const [first] = (await pglite.query<{ id: string }>("SELECT id FROM reviews ORDER BY submitted_at LIMIT 1")).rows;
    await pglite.query("UPDATE reviews SET overall_score = 1.25 WHERE id = $1", [first?.id]);

    await seedEvaluation(ctx);

    const after = await pglite.query<{ n: number }>("SELECT count(*)::int AS n FROM reviews");
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
    // A judge who scores during a walkthrough keeps their score.
    const kept = await pglite.query<{ overall_score: string }>("SELECT overall_score FROM reviews WHERE id = $1", [first?.id]);
    expect(Number(kept.rows[0]?.overall_score)).toBe(1.25);
    expect((await pglite.query<{ n: number }>("SELECT count(*)::int AS n FROM evaluation_plans")).rows[0]?.n).toBe(1);
  });
});
