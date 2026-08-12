import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type JobHeartbeatQuery, recordJobSuccessIn } from "@/shared/server/job-heartbeats";

const migration = readFileSync(new URL("../../drizzle/0019_scheduled_job_heartbeats.sql", import.meta.url), "utf8");

describe("scheduled job heartbeats", () => {
  let pg: PGlite;
  let database: JobHeartbeatQuery;

  beforeAll(async () => {
    pg = new PGlite();
    await pg.exec(migration);
    database = { query: (text, params) => pg.query(text, params) };
  });

  afterAll(async () => pg.close());

  it("upserts only the newest successful completion and bounded duration", async () => {
    await recordJobSuccessIn(database, "outbox", 1200.4, new Date("2026-08-11T12:00:00Z"));
    await recordJobSuccessIn(database, "outbox", 900, new Date("2026-08-11T11:59:00Z"));
    await recordJobSuccessIn(database, "outbox", -5, new Date("2026-08-11T12:01:00Z"));

    const rows = await pg.query<{ job_name: string; last_succeeded_at: Date; last_duration_ms: number }>(
      "select job_name, last_succeeded_at, last_duration_ms from scheduled_job_heartbeats",
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ job_name: "outbox", last_duration_ms: 0 });
    expect(rows.rows[0]?.last_succeeded_at.toISOString()).toBe("2026-08-11T12:01:00.000Z");
  });

  it("rejects an unknown job at the database boundary", async () => {
    await expect(pg.query(
      "insert into scheduled_job_heartbeats(job_name,last_succeeded_at,last_duration_ms) values('unknown',now(),1)",
    )).rejects.toThrow();
  });
});
