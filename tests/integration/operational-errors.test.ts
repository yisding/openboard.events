import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type OperationalErrorQuery,
  operationalErrorFingerprint,
  pruneOperationalErrorsIn,
  recordOperationalErrorIn,
} from "@/shared/server/operational-errors";

// The 0018 -> 0053 transition is exactly what this file exercises: 0053 adds
// `route` and folds it into the bucket identity, so both halves are applied.
const migration = readFileSync(new URL("../../drizzle/0018_operational_error_buckets.sql", import.meta.url), "utf8");
const routeMigration = readFileSync(new URL("../../drizzle/0053_operational_error_route.sql", import.meta.url), "utf8");

describe("operational error aggregation", () => {
  let pg: PGlite;
  let database: OperationalErrorQuery;

  beforeAll(async () => {
    pg = new PGlite();
    await pg.exec(migration);
    await pg.exec(routeMigration);
    database = { query: (text, params) => pg.query(text, params) };
  });

  afterAll(async () => pg.close());

  it("does not let a guessable message influence the durable fingerprint", async () => {
    const withStack = (message: string) => {
      const error = new Error(message);
      error.stack = `Error: ${message}\n    at stableFrame (app.js:1:1)`;
      return error;
    };
    await expect(operationalErrorFingerprint(withStack("customer@example.com")))
      .resolves.toBe(await operationalErrorFingerprint(withStack("secret-token-value")));
  });

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

  // Issue #626 — a paged operator reading this table has to be able to name the
  // endpoint that broke. Two routes failing the same way inside one minute are
  // two failures, so `route` separates them instead of collapsing into one row
  // that names whichever arrived first.
  it("keeps two routes with an identical failure in separate buckets", async () => {
    const error = new Error("db pool exhausted");
    const now = new Date("2026-08-11T12:40:00Z");
    const context = { requestId: "ray-4", feature: "forms", code: "INTERNAL" };

    await recordOperationalErrorIn(database, error, { ...context, route: "/api/internal/forms/[formId]/fields" }, now);
    await recordOperationalErrorIn(database, error, { ...context, route: "/api/internal/forms/[formId]/submit" }, now);
    await recordOperationalErrorIn(database, error, { ...context, route: "/api/internal/forms/[formId]/submit" }, now);

    const rows = await pg.query<{ route: string; occurrences: number }>(
      "select route, occurrences from operational_error_buckets where feature = 'forms' order by route",
    );
    expect(rows.rows).toEqual([
      { route: "/api/internal/forms/[formId]/fields", occurrences: 1 },
      { route: "/api/internal/forms/[formId]/submit", occurrences: 2 },
    ]);
    await pg.query("delete from operational_error_buckets where feature = 'forms'");
  });

  // A job tick or the R2 seam has no request to name; those share one bucket
  // rather than each inventing a route string.
  it("records a routeless caller under the empty route", async () => {
    const error = new Error("cron tick failed");
    await recordOperationalErrorIn(database, error, { requestId: "job", feature: "jobs", code: "INTERNAL" }, new Date("2026-08-11T12:41:00Z"));
    const rows = await pg.query<{ route: string }>("select route from operational_error_buckets where feature = 'jobs'");
    expect(rows.rows).toEqual([{ route: "" }]);
    await pg.query("delete from operational_error_buckets where feature = 'jobs'");
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
