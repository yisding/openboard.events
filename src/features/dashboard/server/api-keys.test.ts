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

const EVENT_A = eventIdSchema.parse("c0000000-0000-4000-8000-000000000001");
const EVENT_B = eventIdSchema.parse("c0000000-0000-4000-8000-000000000002");

let pglite: PGlite;
let db: DbOrTx;

describe("api key lifecycle", () => {
  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migration0);
    await pglite.exec(migration1);
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
    const created = await createApiKeyIn(db, EVENT_A, "  Judge script  ");
    expect(created.plaintext).toMatch(/^ob_live_/);
    expect(created.name).toBe("Judge script");

    const stored = await pglite.query<{ key_hash: string; name: string }>("SELECT key_hash, name FROM api_keys WHERE id=$1", [created.id]);
    expect(stored.rows[0]?.key_hash).not.toBe(created.plaintext);
    expect(stored.rows[0]?.key_hash).not.toContain(created.plaintext);
    expect(stored.rows[0]?.name).toBe("Judge script");
  });

  it("rejects a blank label", async () => {
    await expect(createApiKeyIn(db, EVENT_A, "   ")).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("lists keys scoped to their event, newest first, without ever carrying the plaintext", async () => {
    await createApiKeyIn(db, EVENT_B, "Other event's key");
    const first = await createApiKeyIn(db, EVENT_A, "First key");
    const second = await createApiKeyIn(db, EVENT_A, "Second key");

    const listed = await listApiKeysIn(db, EVENT_A);
    expect(listed.map((key) => key.name)).toEqual(["Second key", "First key", "Judge script"]);
    expect(listed.every((key) => !("plaintext" in key))).toBe(true);
    expect(listed.map((key) => key.id)).toEqual(expect.arrayContaining([first.id, second.id]));
  });

  it("revokes only within the owning event — a cross-event id revokes nothing", async () => {
    const key = await createApiKeyIn(db, EVENT_A, "Revoke me");
    await revokeApiKeyIn(db, EVENT_B, apiKeyIdSchema.parse(key.id));
    expect((await listApiKeysIn(db, EVENT_A)).some((row) => row.id === key.id)).toBe(true);

    await revokeApiKeyIn(db, EVENT_A, apiKeyIdSchema.parse(key.id));
    expect((await listApiKeysIn(db, EVENT_A)).some((row) => row.id === key.id)).toBe(false);

    // A second revoke of an already-revoked id is a silent no-op.
    await expect(revokeApiKeyIn(db, EVENT_A, apiKeyIdSchema.parse(key.id))).resolves.toBeUndefined();
  });
});
