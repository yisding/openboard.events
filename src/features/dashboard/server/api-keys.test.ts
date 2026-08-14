import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbOrTx } from "@/db/client";
import * as schema from "@/db/schema";
import { apiKeyIdSchema, eventIdSchema } from "@/shared/contracts";
import { createApiKeyIn, listApiKeysIn, revokeApiKeyIn } from "./api-keys";

const migration0 = readFileSync(new URL("../../../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");
// M50 is additive on top of the base schema; applying it keeps this fixture
// aligned with the columns the repository modules now read.
const migrationReviewOps = readFileSync(new URL("../../../../drizzle/0004_review_operations.sql", import.meta.url), "utf8");
const migrationApiKeyReceipts = readFileSync(new URL("../../../../drizzle/0036_api_key_creation_receipts.sql", import.meta.url), "utf8");

const EVENT_A = eventIdSchema.parse("c0000000-0000-4000-8000-000000000001");
const EVENT_B = eventIdSchema.parse("c0000000-0000-4000-8000-000000000002");

let pglite: PGlite;
let db: DbOrTx;

function operation(sequence: number, label: string) {
  return {
    operationId: `a0000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`,
    label,
    plaintext: `ob_live_${String(sequence % 10).repeat(43)}`,
  };
}

describe("api key lifecycle", () => {
  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migration0);
    await pglite.exec(migration1);
    await pglite.exec(migrationReviewOps);
    await pglite.exec(migrationApiKeyReceipts);
    db = drizzle(pglite, { schema }) as unknown as DbOrTx;
    await pglite.query(
      `INSERT INTO events(id,name,slug,starts_at,ends_at) VALUES
        ($1,'Event A','event-a','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z'),
        ($2,'Event B','event-b','2026-10-01T16:00:00Z','2026-10-02T01:00:00Z')`,
      [EVENT_A, EVENT_B],
    );
  }, 30_000);

  afterAll(async () => {
    await pglite.close();
  });

  it("creates a key, shows the plaintext once, and never persists it", async () => {
    const input = operation(1, "  Judge script  ");
    const created = await createApiKeyIn(db, EVENT_A, input);
    expect(created.plaintext).toMatch(/^ob_live_/);
    expect(created.name).toBe("Judge script");

    const stored = await pglite.query<{ key_hash: string; name: string }>("SELECT key_hash, name FROM api_keys WHERE id=$1", [created.id]);
    expect(stored.rows[0]?.key_hash).not.toBe(created.plaintext);
    expect(stored.rows[0]?.key_hash).not.toContain(created.plaintext);
    expect(stored.rows[0]?.name).toBe("Judge script");
  });

  it("installs the durable receipt constraints and event lookup index", async () => {
    const constraints = await pglite.query<{ name: string; type: string }>(`
      SELECT conname AS name, contype AS type
      FROM pg_constraint
      WHERE conrelid = 'api_key_creation_receipts'::regclass
    `);
    expect(constraints.rows).toEqual(expect.arrayContaining([
      { name: "api_key_creation_receipts_pkey", type: "p" },
      { name: "api_key_creation_receipts_event_id_fkey", type: "f" },
      { name: "api_key_creation_receipts_payload_fingerprint_ck", type: "c" },
    ]));
    const indexes = await pglite.query<{ name: string }>(`
      SELECT indexname AS name FROM pg_indexes
      WHERE tablename = 'api_key_creation_receipts'
    `);
    expect(indexes.rows).toContainEqual({ name: "api_key_creation_receipts_event_idx" });
  });

  it("rejects blank and raw-overlong labels before persisting a key or receipt", async () => {
    await expect(createApiKeyIn(db, EVENT_A, operation(2, "   "))).rejects.toMatchObject({ name: "ZodError" });
    const rawOverlong = operation(11, `${"A".repeat(120)} `);
    await expect(createApiKeyIn(db, EVENT_A, rawOverlong)).rejects.toMatchObject({ name: "ZodError" });
    const stored = await pglite.query<{ keys: number; receipts: number }>(`
      SELECT
        (SELECT count(*)::int FROM api_keys WHERE id=$1) AS keys,
        (SELECT count(*)::int FROM api_key_creation_receipts WHERE operation_id=$1) AS receipts
    `, [rawOverlong.operationId]);
    expect(stored.rows[0]).toEqual({ keys: 0, receipts: 0 });
  });

  it("lists keys scoped to their event, newest first, without ever carrying the plaintext", async () => {
    await createApiKeyIn(db, EVENT_B, operation(3, "Other event's key"));
    const first = await createApiKeyIn(db, EVENT_A, operation(4, "First key"));
    const second = await createApiKeyIn(db, EVENT_A, operation(5, "Second key"));

    const listed = await listApiKeysIn(db, EVENT_A);
    expect(listed.map((key) => key.name)).toEqual(["Second key", "First key", "Judge script"]);
    expect(listed.every((key) => !("plaintext" in key))).toBe(true);
    expect(listed.map((key) => key.id)).toEqual(expect.arrayContaining([first.id, second.id]));
  });

  it("revokes only within the owning event — a cross-event id revokes nothing", async () => {
    const key = await createApiKeyIn(db, EVENT_A, operation(6, "Revoke me"));
    await revokeApiKeyIn(db, EVENT_B, apiKeyIdSchema.parse(key.id));
    expect((await listApiKeysIn(db, EVENT_A)).some((row) => row.id === key.id)).toBe(true);

    await revokeApiKeyIn(db, EVENT_A, apiKeyIdSchema.parse(key.id));
    expect((await listApiKeysIn(db, EVENT_A)).some((row) => row.id === key.id)).toBe(false);

    // A second revoke of an already-revoked id is a silent no-op.
    await expect(revokeApiKeyIn(db, EVENT_A, apiKeyIdSchema.parse(key.id))).resolves.toBeUndefined();
  });

  it("replays a lost create response as the one canonical key and plaintext", async () => {
    const frozen = operation(7, "Lost response");
    const first = await createApiKeyIn(db, EVENT_A, frozen);
    const replay = await createApiKeyIn(db, EVENT_A, frozen);

    expect(replay).toEqual(first);
    expect(replay.plaintext).toBe(frozen.plaintext);
    const stored = await pglite.query<{ keys: number; receipts: number }>(`
      SELECT
        (SELECT count(*)::int FROM api_keys WHERE id=$1) AS keys,
        (SELECT count(*)::int FROM api_key_creation_receipts WHERE operation_id=$1) AS receipts
    `, [frozen.operationId]);
    expect(stored.rows[0]).toEqual({ keys: 1, receipts: 1 });
  });

  it("rejects an operation id replayed with changed label or plaintext", async () => {
    const frozen = operation(8, "Original details");
    await createApiKeyIn(db, EVENT_A, frozen);

    await expect(createApiKeyIn(db, EVENT_A, { ...frozen, label: "Changed details" }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    await expect(createApiKeyIn(db, EVENT_A, { ...frozen, plaintext: `ob_live_${"x".repeat(43)}` }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    expect((await pglite.query("SELECT id FROM api_keys WHERE id=$1", [frozen.operationId])).rows).toHaveLength(1);
  });

  it("keeps the receipt after revocation and never resurrects a delayed replay", async () => {
    const frozen = operation(9, "Revoked after response loss");
    const created = await createApiKeyIn(db, EVENT_A, frozen);
    await revokeApiKeyIn(db, EVENT_A, created.id);

    await expect(createApiKeyIn(db, EVENT_A, frozen)).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("later revoked"),
    });
    expect((await pglite.query("SELECT id FROM api_keys WHERE id=$1", [frozen.operationId])).rows).toHaveLength(0);
    expect((await pglite.query("SELECT operation_id FROM api_key_creation_receipts WHERE operation_id=$1", [frozen.operationId])).rows).toHaveLength(1);
  });

  it("rolls the receipt back when credential persistence fails", async () => {
    await pglite.exec(`
      CREATE FUNCTION fail_api_key_insert() RETURNS trigger AS $$
      BEGIN
        IF NEW.name = 'Force atomic failure' THEN RAISE EXCEPTION 'forced key insert failure'; END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_api_key_insert_trigger BEFORE INSERT ON api_keys
      FOR EACH ROW EXECUTE FUNCTION fail_api_key_insert();
    `);
    const frozen = operation(10, "Force atomic failure");
    await expect(createApiKeyIn(db, EVENT_A, frozen)).rejects.toThrow();
    const stored = await pglite.query<{ keys: number; receipts: number }>(`
      SELECT
        (SELECT count(*)::int FROM api_keys WHERE id=$1) AS keys,
        (SELECT count(*)::int FROM api_key_creation_receipts WHERE operation_id=$1) AS receipts
    `, [frozen.operationId]);
    expect(stored.rows[0]).toEqual({ keys: 0, receipts: 0 });
    await pglite.exec("DROP TRIGGER fail_api_key_insert_trigger ON api_keys; DROP FUNCTION fail_api_key_insert();");
  });
});
