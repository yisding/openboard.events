import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import { checkRateLimit } from "@/shared/server/rate-limit";

const migration0 = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");
// M50 is additive on top of the base schema; applying it keeps this fixture
// aligned with the columns the repository modules now read.
const migrationReviewOps = readFileSync(new URL("../../drizzle/0004_review_operations.sql", import.meta.url), "utf8");
const migration2 = readFileSync(new URL("../../drizzle/0002_admin_auth.sql", import.meta.url), "utf8");
const migration5 = readFileSync(new URL("../../drizzle/0005_rate_limits.sql", import.meta.url), "utf8");

describe("checkRateLimit (PLAN P3-SEC)", () => {
  let pglite: PGlite;
  let tx: TxDb;

  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migration0);
    await pglite.exec(migration1);
    await pglite.exec(migrationReviewOps);
    await pglite.exec(migration2);
    await pglite.exec(migration5);
    tx = drizzle(pglite, { schema }) as unknown as TxDb;
  }, 30_000);

  afterAll(async () => pglite.close());

  it("allows requests under the limit and rejects the one that crosses it", async () => {
    const key = "submit:form-a:contact-a";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(checkRateLimit(tx, { key, limit: 3, windowMs: 60_000 })).resolves.toBeUndefined();
    }
    await expect(checkRateLimit(tx, { key, limit: 3, windowMs: 60_000 })).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("keeps distinct keys in independent buckets", async () => {
    const a = "bucket:a";
    const b = "bucket:b";
    await checkRateLimit(tx, { key: a, limit: 1, windowMs: 60_000 });
    // a is now at its limit; b, a different key, starts fresh and is unaffected.
    await expect(checkRateLimit(tx, { key: a, limit: 1, windowMs: 60_000 })).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await expect(checkRateLimit(tx, { key: b, limit: 1, windowMs: 60_000 })).resolves.toBeUndefined();
  });

  it("opens a fresh window once the previous one has fully elapsed", async () => {
    const key = "window-reset";
    await checkRateLimit(tx, { key, limit: 1, windowMs: 20 });
    await expect(checkRateLimit(tx, { key, limit: 1, windowMs: 20 })).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await new Promise((resolve) => setTimeout(resolve, 40));
    // The 20ms window has fully elapsed: this call opens a fresh window
    // rather than continuing to count against the expired one.
    await expect(checkRateLimit(tx, { key, limit: 1, windowMs: 20 })).resolves.toBeUndefined();
  });

  it("hashes the key rather than storing it in the clear", async () => {
    const key = "sensitive-email@example.com";
    await checkRateLimit(tx, { key, limit: 5, windowMs: 60_000 });
    const rows = await pglite.query<{ key_hash: string }>("SELECT key_hash FROM rate_limit_buckets");
    expect(rows.rows.every((row) => row.key_hash !== key)).toBe(true);
  });
});
