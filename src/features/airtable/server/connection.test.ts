import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { DbOrTx } from "@/db/client";
import * as schema from "@/db/schema";
import type { AirtableSchemaSnapshot } from "@/db/schema";
import { airtableConnectionIdSchema, eventIdSchema, type EventId } from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";
import {
  attachAirtableBaseIn,
  connectedEventCountIn,
  downgradeSchemaWriteScopeIn,
  getAirtableConnectionIn,
  openAirtableConnectionIn,
  releaseAirtableClaimsIn,
  saveSchemaSnapshotIn,
  storeAirtableTokenIn,
  updateAirtableOptionsIn,
} from "./connection";
import { sealAirtablePat } from "./secret-payload";

/**
 * The connection row's own lifecycle, colocated with the module that owns it.
 *
 * `tests/integration/airtable-sync.test.ts` drives the *engine* — claiming,
 * backoff, run bookkeeping — and reaches this module only for the handful of
 * functions the engine calls. Everything the connect wizard and the settings
 * panel call (paste a token, pick a base, cache a schema, flip a gate) was
 * never covered anywhere, and each of those has a silent failure mode: a token
 * that reaches a response body, a snapshot that outlives the base it describes,
 * a hash that keeps a freshly-created Airtable table empty forever.
 */
const SECRET = "airtable-connection-test-secret-at-least-32-bytes";
const PAT = "patCONNECTIONTEST00000000000000000001";

const migration0 = readFileSync(new URL("../../../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration52 = readFileSync(new URL("../../../../drizzle/0052_airtable_connections.sql", import.meta.url), "utf8");

let pglite: PGlite;
let db: DbOrTx;
let nextSuffix = 0;

async function newEvent(): Promise<EventId> {
  nextSuffix += 1;
  const eventId = eventIdSchema.parse(`a17c0000-0000-4000-8000-${String(nextSuffix).padStart(12, "0")}`);
  await pglite.query(
    "INSERT INTO events(id,name,slug,timezone,starts_at,ends_at) VALUES($1,'E',$2,'UTC','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
    [eventId, `conn-${nextSuffix}`],
  );
  return eventId;
}

function store(eventId: EventId, overrides: { scopes?: string[]; pat?: string } = {}) {
  return storeAirtableTokenIn(db, eventId, {
    pat: overrides.pat ?? PAT,
    airtableUserId: "usrCONNECTIONTEST",
    accountEmail: "organizer@example.com",
    scopes: overrides.scopes ?? ["data.records:read", "data.records:write", "schema.bases:read", "schema.bases:write"],
    connectedByUserId: null,
  });
}

function snapshot(tables: Record<string, string>): AirtableSchemaSnapshot {
  return { tables: Object.fromEntries(Object.entries(tables).map(([key, id]) => [key, { id, fields: {} }])) };
}

async function syncStateKeys(eventId: EventId): Promise<string[]> {
  const { rows } = await pglite.query<{ table_name: string }>(
    "SELECT table_name FROM airtable_sync_state WHERE event_id = $1 ORDER BY table_name",
    [eventId],
  );
  return rows.map((row) => row.table_name);
}

async function seedSyncState(eventId: EventId, tableNames: readonly string[]): Promise<void> {
  for (const [index, tableName] of tableNames.entries()) {
    await pglite.query(
      "INSERT INTO airtable_sync_state(event_id,table_name,record_pk,airtable_record_id,content_hash) VALUES($1,$2,$3,$4,'hash')",
      [eventId, tableName, `pk-${index}`, `rec${index}`],
    );
  }
}

beforeAll(async () => {
  pglite = new PGlite();
  await pglite.exec(migration0);
  await pglite.exec(migration52);
  db = drizzle(pglite, { schema }) as unknown as DbOrTx;
  vi.stubEnv("SESSION_SECRET", SECRET);
}, 60_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await pglite.close();
});

describe("storing a pasted token", () => {
  it("never lets the token, its ciphertext or its fingerprint into the summary", async () => {
    const eventId = await newEvent();
    const summary = await store(eventId);

    // `toSummary` is this module's security boundary — the only path from the
    // row to a response body. Serializing the whole thing is the assertion that
    // matches the claim: not "we did not read those columns" but "none of that
    // material is reachable from what we return".
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain(PAT);
    expect(serialized).not.toContain("tokenCiphertext");
    expect(serialized).not.toContain("tokenFingerprint");
    expect(summary.tokenHint).toBe("0001");
    expect(summary.status).toBe("pending");
    expect(summary.schemaReady).toBe(false);
  });

  it("re-pasting on a chosen base resumes the connection instead of restarting the wizard", async () => {
    const eventId = await newEvent();
    await store(eventId);
    await attachAirtableBaseIn(db, eventId, { baseId: "appONE", baseName: "One" });
    await pglite.query(
      "UPDATE airtable_connections SET status='needs_attention', last_error_key='unauthorized', consecutive_failures=4 WHERE event_id=$1",
      [eventId],
    );

    const resumed = await store(eventId, { pat: `${PAT}ROTATED` });

    expect(resumed.status).toBe("connected");
    expect(resumed.baseId).toBe("appONE");
    expect(resumed.lastErrorKey).toBeNull();
    expect(resumed.consecutiveFailures).toBe(0);
    // The re-pasted token has to be the one that opens now — the conflict
    // branch reseals the ciphertext under the row's new id, and a mismatch
    // there is a credential that never opens again.
    const opened = await openAirtableConnectionIn(db, eventId);
    expect(opened?.pat).toBe(`${PAT}ROTATED`);
  });

  it("keeps a token pasted before a base is chosen in the wizard's pending state", async () => {
    const eventId = await newEvent();
    await store(eventId);

    expect((await store(eventId)).status).toBe("pending");
  });
});

describe("opening the sealed token", () => {
  it("refuses a ciphertext lifted from another event's row", async () => {
    const victim = await newEvent();
    const attacker = await newEvent();
    await store(victim);
    await store(attacker);

    // The AAD binds the envelope to `(event_id, id)`, so copying the bytes
    // across turns a cross-tenant credential lift into a thrown error.
    const [stolen] = await db.select({ ciphertext: schema.airtableConnections.tokenCiphertext })
      .from(schema.airtableConnections)
      .where(eq(schema.airtableConnections.eventId, victim));
    if (!stolen) throw new Error("The victim's connection should exist");
    await db.update(schema.airtableConnections)
      .set({ tokenCiphertext: stolen.ciphertext })
      .where(eq(schema.airtableConnections.eventId, attacker));

    await expect(openAirtableConnectionIn(db, attacker))
      .rejects.toSatisfy((error: unknown) => isAppError(error) && error.code === "VALIDATION");
  });

  it("returns null rather than throwing for an event that never connected", async () => {
    expect(await openAirtableConnectionIn(db, await newEvent())).toBeNull();
    expect(await getAirtableConnectionIn(db, await newEvent())).toBeNull();
  });

  it("opens a ciphertext sealed under the row's own id", async () => {
    const eventId = await newEvent();
    const connectionId = airtableConnectionIdSchema.parse(crypto.randomUUID());
    await db.insert(schema.airtableConnections).values({
      id: connectionId,
      eventId,
      status: "connected",
      tokenCiphertext: await sealAirtablePat({ pat: PAT }, { eventId, connectionId }, SECRET),
      tokenHint: PAT.slice(-4),
      tokenFingerprint: "fingerprint",
      airtableUserId: "usrCONNECTIONTEST",
      baseId: "appONE",
      scopes: ["data.records:write"],
    });

    expect((await openAirtableConnectionIn(db, eventId))?.pat).toBe(PAT);
  });
});

describe("attaching a base", () => {
  it("drops the snapshot and every hash when the base changes", async () => {
    const eventId = await newEvent();
    await store(eventId);
    await attachAirtableBaseIn(db, eventId, { baseId: "appONE", baseName: "One" });
    await saveSchemaSnapshotIn(db, eventId, snapshot({ sessions: "tblOLD" }), "fp-1");
    await seedSyncState(eventId, ["sessions", "contacts"]);

    const summary = await attachAirtableBaseIn(db, eventId, { baseId: "appTWO", baseName: "Two" });

    expect(summary.baseName).toBe("Two");
    expect(summary.schemaReady).toBe(false);
    // Left behind, those hashes would diff clean against an empty new base and
    // the run would report success having written nothing an organizer can see.
    expect(await syncStateKeys(eventId)).toEqual([]);
    const opened = await openAirtableConnectionIn(db, eventId);
    expect(opened?.schemaSnapshot).toBeNull();
  });

  it("keeps the snapshot when the same base is re-selected, and only distrusts it", async () => {
    const eventId = await newEvent();
    await store(eventId);
    await attachAirtableBaseIn(db, eventId, { baseId: "appONE", baseName: "One" });
    await saveSchemaSnapshotIn(db, eventId, snapshot({ sessions: "tblOLD" }), "fp-1");
    await seedSyncState(eventId, ["sessions"]);

    await attachAirtableBaseIn(db, eventId, { baseId: "appONE", baseName: "One (renamed)" });

    // The snapshot is evidence, not cache: it is the only record of which
    // Airtable table each surviving hash was written against.
    const opened = await openAirtableConnectionIn(db, eventId);
    expect(opened?.schemaSnapshot?.tables.sessions?.id).toBe("tblOLD");
    expect(opened?.schemaFingerprint).toBeNull();
    expect(await syncStateKeys(eventId)).toEqual(["sessions"]);
  });

  it("refuses to attach a base to an event with no token", async () => {
    await expect(attachAirtableBaseIn(db, await newEvent(), { baseId: "appONE", baseName: "One" }))
      .rejects.toSatisfy((error: unknown) => isAppError(error) && error.code === "NOT_FOUND");
  });
});

describe("caching the ensured schema", () => {
  it("forgets the hashes of exactly the tables that now point somewhere else", async () => {
    const eventId = await newEvent();
    await store(eventId);
    await attachAirtableBaseIn(db, eventId, { baseId: "appONE", baseName: "One" });
    await saveSchemaSnapshotIn(db, eventId, snapshot({ sessions: "tblS1", contacts: "tblC1" }), "fp-1");
    await seedSyncState(eventId, ["sessions", "contacts"]);

    // An organizer renamed "Sessions" in Airtable, so `ensureBaseSchema`'s
    // name-keyed lookup missed and built a fresh, empty table under a new id.
    await saveSchemaSnapshotIn(db, eventId, snapshot({ sessions: "tblS2", contacts: "tblC1", tracks: "tblT1" }), "fp-2");

    // Only the retargeted key is re-pushed; the untouched table keeps its
    // hashes and a brand-new key never had any to lose.
    expect(await syncStateKeys(eventId)).toEqual(["contacts"]);
    const summary = await getAirtableConnectionIn(db, eventId);
    expect(summary?.schemaReady).toBe(false); // the plan fingerprint, not "fp-2"
    expect((await openAirtableConnectionIn(db, eventId))?.schemaFingerprint).toBe("fp-2");
  });
});

describe("the settings panel's gates", () => {
  it("merges a partial patch over the saved options and leaves sync enablement alone", async () => {
    const eventId = await newEvent();
    await store(eventId);
    await pglite.query("UPDATE airtable_connections SET next_sync_after = now() + interval '1 day' WHERE event_id=$1", [eventId]);

    const updated = await updateAirtableOptionsIn(db, eventId, { includePronouns: true });

    expect(updated.options).toEqual({
      includeEmail: true, includeBio: true, includePronouns: true, includeGender: false, pruneRemoved: false,
    });
    expect(updated.syncEnabled).toBe(true);
    // Flipping a gate changes the projected object, so the backfill has to
    // happen on the next tick rather than up to fifteen minutes later.
    expect(new Date(updated.nextSyncAfter).getTime()).toBeLessThanOrEqual(Date.now() + 1000);

    expect((await updateAirtableOptionsIn(db, eventId, { syncEnabled: false })).syncEnabled).toBe(false);
    expect((await updateAirtableOptionsIn(db, eventId, { includeBio: false })).syncEnabled).toBe(false);
  });

  it("refuses to patch options for an event with no connection", async () => {
    await expect(updateAirtableOptionsIn(db, await newEvent(), { includeBio: false }))
      .rejects.toSatisfy((error: unknown) => isAppError(error) && error.code === "NOT_FOUND");
  });

  it("writes down Airtable's refusal of the assumed schema-write scope", async () => {
    const eventId = await newEvent();
    await store(eventId);

    await downgradeSchemaWriteScopeIn(db, eventId);
    const downgraded = await getAirtableConnectionIn(db, eventId);
    expect(downgraded?.scopes).not.toContain("schema.bases:write");
    expect(downgraded?.scopes).toContain("schema.bases:read");

    // Idempotent, and a no-op on a token that never claimed the scope — the
    // correction is recorded once and the panel stops offering "Rebuild it".
    await downgradeSchemaWriteScopeIn(db, eventId);
    expect((await getAirtableConnectionIn(db, eventId))?.scopes).toEqual(downgraded?.scopes);
    await expect(downgradeSchemaWriteScopeIn(db, await newEvent())).resolves.toBeUndefined();
  });
});

describe("claims and counts", () => {
  it("hands an unreached claim straight back to the next tick", async () => {
    const eventId = await newEvent();
    await store(eventId);
    await attachAirtableBaseIn(db, eventId, { baseId: "appONE", baseName: "One" });
    await pglite.query("UPDATE airtable_connections SET next_sync_after = now() + interval '15 minutes' WHERE event_id=$1", [eventId]);

    await releaseAirtableClaimsIn(db, [eventId]);

    // Not "fifteen minutes late": a tenant that keeps landing in the tail of a
    // sweep would otherwise sync at half the advertised cadence silently.
    const summary = await getAirtableConnectionIn(db, eventId);
    expect(new Date(summary?.nextSyncAfter ?? 0).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    await expect(releaseAirtableClaimsIn(db, [])).resolves.toBeUndefined();
  });

  it("counts only the connections that actually reached a base", async () => {
    const before = await connectedEventCountIn(db);
    const pending = await newEvent();
    const connected = await newEvent();
    await store(pending);
    await store(connected);
    await attachAirtableBaseIn(db, connected, { baseId: "appCOUNT", baseName: "Count" });

    // The pending row is a wizard someone walked away from, not a setup event.
    expect(await connectedEventCountIn(db)).toBe(before + 1);
  });
});
