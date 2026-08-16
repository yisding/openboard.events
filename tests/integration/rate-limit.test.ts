import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import { claimWebhookDelivery } from "@/features/comms";
import { retryAfterSeconds } from "@/shared/lib/errors";
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

  it("serializes concurrent increments against one key", async () => {
    const results = await Promise.allSettled(Array.from({ length: 12 }, async () => {
      await checkRateLimit(tx, { key: "concurrent-credential-burst", limit: 1, windowMs: 60_000 });
    }));

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(11);
    for (const result of results) {
      if (result.status === "rejected") expect(result.reason).toMatchObject({ code: "RATE_LIMITED" });
    }
  });

  it("opens a fresh window once the previous one has fully elapsed", async () => {
    // Fakes only `Date` (not timers): a real 20ms wall-clock margin is too
    // tight under CI/parallel load, where a single PGlite round trip can
    // itself take longer than that and make even back-to-back calls land in
    // different windows. Controlling the clock directly makes the "still
    // inside the window" vs "window elapsed" cases deterministic.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const key = "window-reset";
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
      await checkRateLimit(tx, { key, limit: 1, windowMs: 20 });
      await expect(checkRateLimit(tx, { key, limit: 1, windowMs: 20 })).rejects.toMatchObject({ code: "RATE_LIMITED" });
      // The 20ms window has fully elapsed: this call opens a fresh window
      // rather than continuing to count against the expired one.
      vi.setSystemTime(new Date("2026-01-01T00:00:00.021Z"));
      await expect(checkRateLimit(tx, { key, limit: 1, windowMs: 20 })).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("hashes the key rather than storing it in the clear", async () => {
    const key = "sensitive-email@example.com";
    await checkRateLimit(tx, { key, limit: 5, windowMs: 60_000 });
    const rows = await pglite.query<{ key_hash: string }>("SELECT key_hash FROM rate_limit_buckets");
    expect(rows.rows.every((row) => row.key_hash !== key)).toBe(true);
  });

  // The refusal carries the bucket's own reset so `errorEnvelope` can publish a
  // `Retry-After` that is arithmetic rather than a guess.
  it("reports seconds to reset from the window it actually opened", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const key = "retry-after";
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
      await checkRateLimit(tx, { key, limit: 1, windowMs: 60_000 });
      vi.setSystemTime(new Date("2026-01-01T00:00:15.000Z"));
      const refusal = await checkRateLimit(tx, { key, limit: 1, windowMs: 60_000 }).catch((error: unknown) => error);
      // 60s window opened at :00, refused at :15 — 45 seconds left, not 60.
      expect(retryAfterSeconds(refusal)).toBe(45);
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * Issue #631 — the Resend webhook verified an HMAC and a five-minute timestamp
 * tolerance but recorded nothing about the delivery, so a captured payload
 * replayed freely inside that window.
 */
describe("claimWebhookDelivery (issue #631)", () => {
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

  it("claims a delivery id once and refuses the replay", async () => {
    await expect(claimWebhookDelivery(tx, "resend", "msg_2abc")).resolves.toBe(true);
    await expect(claimWebhookDelivery(tx, "resend", "msg_2abc")).resolves.toBe(false);
    await expect(claimWebhookDelivery(tx, "resend", "msg_2abc")).resolves.toBe(false);
  });

  it("keeps distinct deliveries and distinct providers independent", async () => {
    await expect(claimWebhookDelivery(tx, "resend", "msg_first")).resolves.toBe(true);
    await expect(claimWebhookDelivery(tx, "resend", "msg_second")).resolves.toBe(true);
    // A future provider reusing an id string must not be refused by ours.
    await expect(claimWebhookDelivery(tx, "billing", "msg_first")).resolves.toBe(true);
  });

  // The claim outlives the signature tolerance that would let the replay
  // verify at all, so the two can never leave a gap between them.
  it("holds the claim for the whole signature tolerance window", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
      await expect(claimWebhookDelivery(tx, "resend", "msg_window")).resolves.toBe(true);
      // 4m59s later: still inside the five-minute tolerance, still refused.
      vi.setSystemTime(new Date("2026-01-01T00:04:59.000Z"));
      await expect(claimWebhookDelivery(tx, "resend", "msg_window")).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  // A swallowed storage failure would be the worst possible outcome here: every
  // delivery would read as a replay, and the endpoint would go on answering 200
  // while silently recording no suppressions at all. Unlike the abuse counters,
  // this one must fail loudly.
  it("propagates a storage failure instead of reporting it as a duplicate", async () => {
    const broken = {
      insert: () => { throw new Error('relation "rate_limit_buckets" does not exist'); },
    } as unknown as TxDb;
    await expect(claimWebhookDelivery(broken, "resend", "msg_storage_down")).rejects.toThrow(/rate_limit_buckets/);
  });

  it("hashes the delivery id rather than storing it in the clear", async () => {
    await claimWebhookDelivery(tx, "resend", "msg_secret_delivery");
    const rows = await pglite.query<{ key_hash: string }>("SELECT key_hash FROM rate_limit_buckets");
    expect(rows.rows.every((row) => !row.key_hash.includes("msg_secret_delivery"))).toBe(true);
  });
});
