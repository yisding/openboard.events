import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { eventIdSchema } from "@/shared/contracts";

/**
 * Cross-event scoping of the keyed `/api/v1` routes, exercised through a REAL
 * route handler rather than a hand-called query.
 *
 * `apiKeyAuth()` is the single implementation of hashed-bearer auth in the repo
 * and the only thing standing between a key issued for event A and every other
 * event's private data, so "the join looks right" is not evidence. This drives
 * the deployed `GET /api/v1/events/{slug}/stats` handler — guard, envelope,
 * status code and headers included — against a real Postgres holding two
 * events and one key, which is what M40 step 4's "a key issued for event A
 * returns 401 on event B's endpoints" actually asserts.
 */
const migration0 = readFileSync(new URL("../../../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");
// M50 is additive on top of the base schema; applying it keeps this fixture
// aligned with the columns the repository modules now read.
const migrationReviewOps = readFileSync(new URL("../../../../drizzle/0004_review_operations.sql", import.meta.url), "utf8");
// The stats route is wired through `defineHandler`'s `rateLimit` option
// (PLAN P3-SEC), which hits `rate_limit_buckets` on every request; without
// this migration every call 500s before the auth assertions below ever run.
const migrationRateLimits = readFileSync(new URL("../../../../drizzle/0005_rate_limits.sql", import.meta.url), "utf8");
const migrationApiKeyReceipts = readFileSync(new URL("../../../../drizzle/0036_api_key_creation_receipts.sql", import.meta.url), "utf8");

const EVENT_A = eventIdSchema.parse("c0000000-0000-4000-8000-000000000001");
const EVENT_B = eventIdSchema.parse("c0000000-0000-4000-8000-000000000002");
const SLUG_A = "keyed-a";
const SLUG_B = "keyed-b";

const pglite = new PGlite();
const testDb = drizzle(pglite, { schema });

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return {
    ...actual,
    db: new Proxy({}, { get: (_target, property) => Reflect.get(testDb, property, testDb) }),
  };
});

const { GET: getStats } = await import("./events/[slug]/stats/route");
const { createApiKeyIn } = await import("@/features/dashboard/server/api-keys");

function statsRequest(slug: string, authorization?: string): [NextRequest, { params: Promise<{ slug: string }> }] {
  return [
    new NextRequest(`https://example.test/api/v1/events/${slug}/stats`, {
      headers: authorization ? { authorization } : {},
    }),
    { params: Promise.resolve({ slug }) },
  ];
}

type Envelope = { error?: { code: string; message: string }; data?: unknown };

function operation(sequence: number, label: string) {
  return {
    operationId: `b0000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`,
    label,
    plaintext: `ob_live_${String(sequence).repeat(43)}`,
  };
}

describe("api/v1 keyed routes — API key event scoping", () => {
  let keyA = "";

  beforeAll(async () => {
    await pglite.exec(migration0);
    await pglite.exec(migration1);
    await pglite.exec(migrationReviewOps);
    await pglite.exec(migrationRateLimits);
    await pglite.exec(migrationApiKeyReceipts);
    await pglite.query(
      `INSERT INTO events(id,name,slug,timezone,starts_at,ends_at) VALUES
        ($1,'Keyed A',$3,'America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z'),
        ($2,'Keyed B',$4,'America/Los_Angeles','2026-10-15T16:00:00Z','2026-10-17T01:00:00Z')`,
      [EVENT_A, EVENT_B, SLUG_A, SLUG_B],
    );
    // Issued through the real creation path, so the stored hash is exactly what
    // `apiKeyAuth()` recomputes — a fixture hash could hide a hashing mismatch.
    keyA = (await createApiKeyIn(testDb as never, EVENT_A, operation(1, "judge script"))).plaintext;
  }, 60_000);

  afterAll(async () => {
    await pglite.close();
  });

  it("accepts event A's key on event A's slug", async () => {
    const response = await getStats(...statsRequest(SLUG_A, `Bearer ${keyA}`));
    expect(response.status).toBe(200);
    const payload = await response.json() as Envelope;
    expect(Object.keys(payload.data as object).sort()).toEqual(["kpis", "speakerTracking", "statusCounts"]);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("401s event A's key on event B's slug — cross-event scoping", async () => {
    const response = await getStats(...statsRequest(SLUG_B, `Bearer ${keyA}`));
    expect(response.status).toBe(401);
    const payload = await response.json() as Envelope;
    expect(payload.error?.code).toBe("UNAUTHORIZED");
    expect(payload.data).toBeUndefined();
    // 401 before 404, and no shared cache for a rejection either.
    expect(response.headers.get("cache-control")).toBe("private, no-store");

    // The rejected attempt must not touch the key's usage trail — nothing about
    // event B may be inferable from a key that has no business there.
    const { rows } = await pglite.query<{ last_used_at: string | null; event_id: string }>(
      "SELECT last_used_at, event_id FROM api_keys",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.event_id).toBe(EVENT_A);
  });

  it("401s a key-shaped string that was never issued, and a missing header", async () => {
    const forged = await getStats(...statsRequest(SLUG_A, "Bearer ob_live_not-a-real-key"));
    expect(forged.status).toBe(401);
    expect((await forged.json() as Envelope).error?.code).toBe("UNAUTHORIZED");

    const anonymous = await getStats(...statsRequest(SLUG_A));
    expect(anonymous.status).toBe(401);
    expect((await anonymous.json() as Envelope).error?.code).toBe("UNAUTHORIZED");
  });

  it("401s before 404 on a slug that does not exist at all", async () => {
    const response = await getStats(...statsRequest("no-such-event", `Bearer ${keyA}`));
    expect(response.status).toBe(401);
    expect((await response.json() as Envelope).error?.code).toBe("UNAUTHORIZED");
  });

  it("stops accepting a revoked key immediately", async () => {
    const doomed = (await createApiKeyIn(testDb as never, EVENT_A, operation(2, "temporary"))).plaintext;
    expect((await getStats(...statsRequest(SLUG_A, `Bearer ${doomed}`))).status).toBe(200);

    await pglite.query("DELETE FROM api_keys WHERE name='temporary'");
    const after = await getStats(...statsRequest(SLUG_A, `Bearer ${doomed}`));
    expect(after.status).toBe(401);
    // The surviving key is unaffected.
    expect((await getStats(...statsRequest(SLUG_A, `Bearer ${keyA}`))).status).toBe(200);
  });
});
