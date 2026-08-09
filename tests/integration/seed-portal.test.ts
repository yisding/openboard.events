import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import { sanitize } from "@/shared/lib/sanitize";
import { seedPortal } from "../../scripts/seed/portal";
import { SEEDED_EMPTY_EVENT_ID, SEEDED_EVENT_ID } from "../../scripts/seed/lib/helpers";
import { seedId } from "../../scripts/seed/lib/ids";

const migration0 = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");

describe("portal seed", () => {
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
    ctx = {
      tx: drizzle(pglite, { schema }) as unknown as TxDb,
      now: new Date("2026-08-09T12:00:00.000Z"),
      eventId: SEEDED_EVENT_ID,
      emptyEventId: SEEDED_EMPTY_EVENT_ID,
      id: seedId,
      log: (message: string) => logs.push(message),
    };
    await seedPortal(ctx);
  }, 60_000);

  afterAll(async () => {
    await pglite.close();
  });

  it("seeds one task per completion mode, with one already overdue", async () => {
    const rows = await pglite.query<{ completion_mode: string; due_at: Date | null }>(
      "SELECT completion_mode, due_at FROM portal_tasks ORDER BY sort_order",
    );
    expect(rows.rows).toHaveLength(3);
    expect(rows.rows.some((row) => row.completion_mode === "file_request")).toBe(true);
    // The overdue row is what keeps the overdue list non-empty and gives the
    // reminder scan something to find on its first tick.
    expect(rows.rows.filter((row) => row.due_at !== null && row.due_at < ctx.now)).toHaveLength(1);
  });

  it("points the file-request task at a real file request", async () => {
    const rows = await pglite.query<{ file_request_id: string | null; max_size_mb: number }>(
      `SELECT t.file_request_id, r.max_size_mb FROM portal_tasks t
       JOIN file_requests r ON r.id = t.file_request_id
       WHERE t.completion_mode = 'file_request'`,
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.max_size_mb).toBe(100);
  });

  it("keeps the allowlisted embed and strips the script", async () => {
    const rows = await pglite.query<{ slug: string; body_html: string }>("SELECT slug, body_html FROM resource_pages ORDER BY sort_order");
    const [handbook, guidelines] = rows.rows;

    // The two probes are the point of these pages: they render where a judge
    // will actually look, so a sanitizer regression is visible rather than
    // theoretical.
    expect(sanitize(handbook?.body_html ?? "", { profile: "wide" })).toContain("youtube.com/embed");
    expect(sanitize(handbook?.body_html ?? "")).not.toContain("<iframe");
    expect(guidelines?.body_html).toContain("<script>");
    expect(sanitize(guidelines?.body_html ?? "", { profile: "wide" })).not.toContain("<script");
  });

  it("re-runs as a no-op rather than duplicating", async () => {
    await seedPortal(ctx);
    const counts = await pglite.query<{ tasks: number; requests: number; pages: number }>(
      `SELECT (SELECT count(*)::int FROM portal_tasks) AS tasks,
              (SELECT count(*)::int FROM file_requests) AS requests,
              (SELECT count(*)::int FROM resource_pages) AS pages`,
    );
    expect(counts.rows[0]).toEqual({ tasks: 3, requests: 1, pages: 2 });
  });

  it("leaves the empty event empty", async () => {
    const rows = await pglite.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM portal_tasks WHERE event_id = $1",
      [SEEDED_EMPTY_EVENT_ID],
    );
    expect(rows.rows[0]?.count).toBe(0);
  });
});
