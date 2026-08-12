import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type OperationalErrorQuery,
  operationalErrorFingerprint,
  pruneOperationalErrorsIn,
  recordOperationalErrorIn,
} from "@/shared/server/operational-errors";

const migration = readFileSync(new URL("../../drizzle/0018_operational_error_buckets.sql", import.meta.url), "utf8");

describe("operational error aggregation", () => {
  let pg: PGlite;
  let database: OperationalErrorQuery;

  beforeAll(async () => {
    pg = new PGlite();
    await pg.exec(migration);
    database = { query: (text, params) => pg.query(text, params) };
  });

  afterAll(async () => pg.close());

  it("stores no raw diagnostic and aggregates identical failures by minute", async () => {
    const error = new Error("customer@example.com failed to render");
    const now = new Date("2026-08-11T12:34:10Z");
    const context = { requestId: "ray-1", feature: "next-render", code: "UNCAUGHT_REQUEST_ERROR" };

    await recordOperationalErrorIn(database, error, context, now);
    await recordOperationalErrorIn(database, error, { ...context, requestId: "ray-2" }, new Date("2026-08-11T12:34:50Z"));

    const rows = await pg.query<{
      fingerprint: string;
      feature: string;
      code: string;
      bucket_started_at: Date;
      occurrences: number;
    }>("select fingerprint, feature, code, bucket_started_at, occurrences from operational_error_buckets");
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({
      fingerprint: await operationalErrorFingerprint(error),
      feature: "next-render",
      code: "UNCAUGHT_REQUEST_ERROR",
      occurrences: 2,
    });
    expect(JSON.stringify(rows.rows[0])).not.toContain("customer@example.com");
    expect(rows.rows[0]?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("starts a new minute bucket and prunes history after seven days", async () => {
    const error = new Error("customer@example.com failed to render");
    await recordOperationalErrorIn(
      database,
      error,
      { requestId: "ray-3", feature: "next-render", code: "UNCAUGHT_REQUEST_ERROR" },
      new Date("2026-08-11T12:35:01Z"),
    );

    const before = await pg.query<{ count: number }>("select count(*)::int as count from operational_error_buckets");
    expect(before.rows[0]?.count).toBe(2);

    const result = await pruneOperationalErrorsIn(database, new Date("2026-08-19T12:36:00Z"));
    expect(result).toEqual({ deletedOperationalErrorBuckets: 2 });
    const after = await pg.query<{ count: number }>("select count(*)::int as count from operational_error_buckets");
    expect(after.rows[0]?.count).toBe(0);
  });
});
