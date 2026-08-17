import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { DbOrTx } from "@/db/client";
import * as schema from "@/db/schema";
import { airtableConnections, type AirtableSchemaSnapshot } from "@/db/schema";
import { airtableConnectionIdSchema, eventIdSchema, type EventId } from "@/shared/contracts";
import { ALL_SCOPES, REQUIRED_SCOPES } from "@/features/airtable/scopes";
import { AirtableError, type AirtableClient, type AirtableFieldRef } from "@/features/airtable/server/client";
import { ensureBaseSchema } from "@/features/airtable/server/schema-sync";
import {
  chooseAirtableBaseIn,
  claimDueAirtableConnectionsIn,
  disconnectAirtableIn,
  getAirtableConnectionIn,
  invalidateSchemaSnapshotIn,
  markConnectionNeedsAttentionIn,
  pruneAbandonedAirtableConnectionsIn,
  recordSyncOutcomeIn,
  validateAirtableTokenIn,
} from "@/features/airtable/server/connection";
import { sealAirtablePat } from "@/features/airtable/server/secret-payload";
import { listSyncRunsIn } from "@/features/airtable/server/runs";
import { runAirtableSyncForEventIn, runDueAirtableSyncsIn } from "@/features/airtable/server/sync";

/**
 * The sync engine against a fake, in-memory Airtable — never the real network.
 *
 * Two assertions matter more than the rest of this file combined, because
 * they are what make "idempotent" a property of the write rather than a claim
 * about the code around it (D1, `runAirtableSyncForEventIn`'s own doc
 * comment):
 *
 * - a second run with nothing changed makes **zero** write calls, and
 * - a lost `airtable_sync_state` row (a torn write) re-pushes the same record
 *   as an *update*, never a duplicate create.
 *
 * Everything else here is the budget, backoff, and isolation machinery that
 * makes bounded, per-tenant work honest.
 */

const SECRET = "airtable-integration-test-secret-at-least-32-bytes";
const FAKE_PAT = "patFAKE0000000000000000INTEGRATIONTEST";
const APP_BASE_URL = "https://events.example.com";

/*
 * The whole ordered chain, not `0000_init` plus this feature's own migration.
 *
 * The engine projects `tracks`, `rooms`, `session_formats`, `tags`, `contacts`,
 * `sessions` and `submissions` — seven tables that a dozen later migrations have
 * since altered, adding columns, defaults and constraints that `0000_init` alone
 * does not carry. A fixture that skips them is a schema no deployment has ever
 * run, and the assertions about what the projection reads and what the database
 * will accept are only worth what the fixture's fidelity is worth.
 */
const MIGRATIONS = readdirSync(new URL("../../drizzle/", import.meta.url))
  .filter((name) => name.endsWith(".sql"))
  .sort();

const captureErrorMock = vi.hoisted(() => vi.fn());
vi.mock("@/shared/lib/error-tracking", () => ({ captureError: captureErrorMock }));

let pglite: PGlite;
let db: DbOrTx;
let idSeq = 1;

/** Sequential, readable, collision-free UUIDs for this file only. */
function nextId(): string {
  const value = (idSeq++).toString().padStart(12, "0");
  return `a17bc000-0000-4000-8000-${value}`;
}

async function seedEvent(id: string, name = "Fixture"): Promise<void> {
  await pglite.query(
    "INSERT INTO events(id,name,slug,timezone,starts_at,ends_at) VALUES($1,$2,$3,'UTC','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
    [id, name, `evt-${id.slice(-12)}`],
  );
}

async function seedTrack(id: string, eventId: string, name: string): Promise<void> {
  await pglite.query("INSERT INTO tracks(id,event_id,name) VALUES($1,$2,$3)", [id, eventId, name]);
}

async function seedContact(id: string, eventId: string, overrides: { firstName?: string; lastName?: string } = {}): Promise<void> {
  await pglite.query(
    "INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES($1,$2,$3,$4,$5)",
    [id, eventId, `c-${id.slice(-8)}@example.com`, overrides.firstName ?? "First", overrides.lastName ?? "Last"],
  );
}

async function seedSession(id: string, eventId: string, overrides: { title?: string; trackId?: string | null } = {}): Promise<void> {
  await pglite.query(
    "INSERT INTO sessions(id,event_id,title,slug,track_id) VALUES($1,$2,$3,$4,$5)",
    [id, eventId, overrides.title ?? "Session", `s-${id.slice(-8)}`, overrides.trackId ?? null],
  );
}

async function seedSpeaker(sessionId: string, eventId: string, contactId: string, sortOrder = 0): Promise<void> {
  await pglite.query(
    "INSERT INTO session_speakers(event_id,session_id,contact_id,sort_order) VALUES($1,$2,$3,$4)",
    [eventId, sessionId, contactId, sortOrder],
  );
}

/* ---- Fake Airtable: an in-memory base, exercised through the real AirtableClient shape. ---- */

type FakeTable = { id: string; name: string; fields: AirtableFieldRef[]; records: Map<string, Record<string, unknown>> };
type ScheduledError = { kind: AirtableError["kind"]; status: number | undefined; afterCalls: number; times: number };

type FakeStore = {
  baseId: string;
  tables: Map<string, FakeTable>; // keyed by display name
  callLog: { method: string; tableId?: string; count?: number }[];
  scheduled: ScheduledError | null;
  nextTableSeq: number;
  nextFieldSeq: number;
  nextRecordSeq: number;
};

function createFakeStore(baseId = "appFAKETEST0001"): FakeStore {
  return { baseId, tables: new Map(), callLog: [], scheduled: null, nextTableSeq: 1, nextFieldSeq: 1, nextRecordSeq: 1 };
}

/** Throws the scheduled error exactly `times` times, after `afterCalls` calls elapse first. */
function scheduleError(store: FakeStore, kind: ScheduledError["kind"], status?: number, options: { afterCalls?: number; times?: number } = {}): void {
  store.scheduled = { kind, status, afterCalls: options.afterCalls ?? 0, times: options.times ?? 1 };
}

function maybeThrow(store: FakeStore): void {
  const scheduled = store.scheduled;
  if (!scheduled) return;
  if (scheduled.afterCalls > 0) {
    scheduled.afterCalls -= 1;
    return;
  }
  scheduled.times -= 1;
  if (scheduled.times <= 0) store.scheduled = null;
  throw new AirtableError(scheduled.kind, `fake ${scheduled.kind}`, scheduled.status);
}

function tableById(store: FakeStore, tableId: string): FakeTable {
  const table = [...store.tables.values()].find((candidate) => candidate.id === tableId);
  if (!table) throw new Error(`fake Airtable: unknown table id ${tableId}`);
  return table;
}

/** The named table, or a loud failure — every test below expects this exact one to exist. */
function tableByName(store: FakeStore, name: string): FakeTable {
  const table = store.tables.get(name);
  if (!table) throw new Error(`fake Airtable: expected a "${name}" table to have been created`);
  return table;
}

function createFakeAirtableClient(store: FakeStore): AirtableClient {
  return {
    async whoami() {
      return { userId: "usrFAKETEST0001", email: null, scopes: [...ALL_SCOPES] };
    },
    async listBases() {
      return [{ id: store.baseId, name: "Fake Base", permissionLevel: "create" }];
    },
    async createBase() {
      throw new Error("not exercised by these tests");
    },

    async getBaseSchema() {
      maybeThrow(store);
      store.callLog.push({ method: "getBaseSchema" });
      return [...store.tables.values()].map((table) => ({ id: table.id, name: table.name, fields: [...table.fields] }));
    },

    async createTable(_baseId, spec) {
      maybeThrow(store);
      const fields: AirtableFieldRef[] = spec.fields.map((field) => ({ id: `fld${String(store.nextFieldSeq++).padStart(4, "0")}`, name: field.name, type: field.type }));
      const table: FakeTable = { id: `tbl${String(store.nextTableSeq++).padStart(4, "0")}`, name: spec.name, fields, records: new Map() };
      store.tables.set(spec.name, table);
      store.callLog.push({ method: "createTable", tableId: table.id });
      return { id: table.id, name: table.name, fields: table.fields };
    },

    async createField(_baseId, tableId, spec) {
      maybeThrow(store);
      const table = tableById(store, tableId);
      const field: AirtableFieldRef = { id: `fld${String(store.nextFieldSeq++).padStart(4, "0")}`, name: spec.name, type: spec.type };
      table.fields.push(field);
      store.callLog.push({ method: "createField", tableId });
      return field;
    },

    async upsertRecords(_baseId, tableId, records, mergeOn) {
      maybeThrow(store);
      store.callLog.push({ method: "upsertRecords", tableId, count: records.length });
      const table = tableById(store, tableId);
      const mergeKey = mergeOn[0];
      if (!mergeKey) throw new Error("fake Airtable: performUpsert needs at least one merge field");
      const createdRecords: string[] = [];
      const updatedRecords: string[] = [];
      const outRecords = records.map((record) => {
        const key = record.fields[mergeKey];
        const existing = [...table.records.entries()].find(([, fields]) => fields[mergeKey] === key);
        if (existing) {
          const merged = { ...existing[1], ...record.fields };
          table.records.set(existing[0], merged);
          updatedRecords.push(existing[0]);
          return { id: existing[0], fields: merged };
        }
        const id = `rec${String(store.nextRecordSeq++).padStart(6, "0")}`;
        table.records.set(id, { ...record.fields });
        createdRecords.push(id);
        return { id, fields: record.fields };
      });
      return { records: outRecords, createdRecords, updatedRecords };
    },

    async deleteRecords(_baseId, tableId, recordIds) {
      maybeThrow(store);
      store.callLog.push({ method: "deleteRecords", tableId, count: recordIds.length });
      const table = tableById(store, tableId);
      return recordIds.map((id) => ({ id, deleted: table.records.delete(id) }));
    },

    get callCount() { return store.callLog.length; },
    get rateLimitedCount() { return 0; },
  };
}

/**
 * One token, several bases — each call routed to the store for the base it
 * names. The single-store fake ignores `baseId`, which is exactly the blind
 * spot that let "re-point at a different base" look like it worked.
 */
function createMultiBaseAirtableClient(stores: readonly FakeStore[]): AirtableClient {
  const clients = new Map(stores.map((store) => [store.baseId, createFakeAirtableClient(store)]));
  const forBase = (baseId: string): AirtableClient => {
    const client = clients.get(baseId);
    if (!client) throw new AirtableError("not_found", `fake Airtable: no base ${baseId}`, 404);
    return client;
  };
  return {
    async whoami() { return { userId: "usrFAKETEST0001", email: null, scopes: [...ALL_SCOPES] }; },
    async listBases() {
      return stores.map((store) => ({ id: store.baseId, name: `Fake ${store.baseId}`, permissionLevel: "create" }));
    },
    async createBase() { throw new Error("not exercised by these tests"); },
    getBaseSchema: (baseId) => forBase(baseId).getBaseSchema(baseId),
    createTable: (baseId, spec) => forBase(baseId).createTable(baseId, spec),
    createField: (baseId, tableId, spec, linkedTableId) => forBase(baseId).createField(baseId, tableId, spec, linkedTableId),
    upsertRecords: (baseId, tableId, records, mergeOn) => forBase(baseId).upsertRecords(baseId, tableId, records, mergeOn),
    deleteRecords: (baseId, tableId, recordIds) => forBase(baseId).deleteRecords(baseId, tableId, recordIds),
    get callCount() { return stores.reduce((total, store) => total + store.callLog.length, 0); },
    get rateLimitedCount() { return 0; },
  };
}

/** Builds a fully-formed base matching `TABLE_PLANS`, the way a first sync would. */
async function buildMatchingSchema(store: FakeStore) {
  const result = await ensureBaseSchema(createFakeAirtableClient(store), { baseId: store.baseId, canManageSchema: true });
  if (!result.ok) throw new Error("expected ensureBaseSchema to succeed while building the fixture");
  return result;
}

/* ---- Connection fixture ---- */

async function connectEvent(eventId: EventId, options: {
  scopes?: readonly string[];
  syncEnabled?: boolean;
  status?: "pending" | "connected" | "needs_attention";
  baseId?: string;
  baseName?: string;
  lastSyncedAt?: Date | null;
  nextSyncAfter?: Date;
  schema?: { snapshot: AirtableSchemaSnapshot; fingerprint: string };
  pruneRemoved?: boolean;
} = {}) {
  const connectionId = airtableConnectionIdSchema.parse(crypto.randomUUID());
  const tokenCiphertext = await sealAirtablePat({ pat: FAKE_PAT }, { eventId, connectionId }, SECRET);
  await db.insert(airtableConnections).values({
    id: connectionId,
    eventId,
    status: options.status ?? "connected",
    tokenCiphertext,
    tokenHint: FAKE_PAT.slice(-4),
    tokenFingerprint: "fingerprint",
    airtableUserId: "usrFAKETEST0001",
    scopes: [...(options.scopes ?? ALL_SCOPES)],
    baseId: options.baseId ?? "appFAKETEST0001",
    baseName: options.baseName ?? "Fake Base",
    syncEnabled: options.syncEnabled ?? true,
    options: {
      includeEmail: true, includeBio: true, includePronouns: false, includeGender: false,
      includeHeadshots: true, pruneRemoved: options.pruneRemoved ?? false,
    },
    ...(options.schema ? { schemaSnapshot: options.schema.snapshot, schemaFingerprint: options.schema.fingerprint } : {}),
    ...(options.lastSyncedAt !== undefined ? { lastSyncedAt: options.lastSyncedAt } : {}),
    ...(options.nextSyncAfter ? { nextSyncAfter: options.nextSyncAfter } : {}),
  });
  return connectionId;
}

const past = () => new Date(Date.now() - 60_000);

/**
 * Pushes every connection this file has ever created out of the "due"
 * window. The global claim/sweep functions scan the whole table, not one
 * event — so a test asserting an exact claimed count has to first make sure
 * no earlier test's fixture (left "due" on purpose, or never claimed because
 * it exceeded another test's limit) is sitting in the same window.
 */
async function quarantineAllOtherConnections(): Promise<void> {
  await pglite.query("UPDATE airtable_connections SET next_sync_after = now() + interval '1 day'");
}

async function countRows(sql: string, params: unknown[]): Promise<number> {
  const { rows } = await pglite.query<{ count: string }>(sql, params);
  return Number(rows[0]?.count ?? 0);
}

beforeAll(async () => {
  pglite = new PGlite();
  for (const name of MIGRATIONS) {
    await pglite.exec(readFileSync(new URL(`../../drizzle/${name}`, import.meta.url), "utf8"));
  }
  db = drizzle(pglite, { schema }) as unknown as DbOrTx;
  vi.stubEnv("SESSION_SECRET", SECRET);
  // The origin a speaker's `Headshot` attachment URL is built from. Pinned so
  // the assertion is about what the projection does with it, not about whatever
  // the machine running the suite happens to export.
  vi.stubEnv("APP_BASE_URL", APP_BASE_URL);
}, 60_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await pglite.close();
});

afterEach(() => {
  captureErrorMock.mockClear();
});

describe("idempotency — the property, not the claim", () => {
  it("first run creates state; second run with nothing changed makes zero write calls; one edit re-pushes exactly one record", async () => {
    const eventId = eventIdSchema.parse(nextId());
    const trackId = nextId();
    const sessionId = nextId();
    await seedEvent(eventId);
    await seedTrack(trackId, eventId, "Platform");
    await seedSession(sessionId, eventId, { trackId });

    const store = createFakeStore();
    await connectEvent(eventId);

    const first = await runAirtableSyncForEventIn(db, eventId, { trigger: "manual", makeClient: () => createFakeAirtableClient(store) });
    expect(first.status).toBe("success");
    expect(first.stats.created).toBeGreaterThan(0);

    const writesBeforeSecondRun = store.callLog.filter((entry) => entry.method === "upsertRecords" || entry.method === "deleteRecords").length;
    const second = await runAirtableSyncForEventIn(db, eventId, { trigger: "manual", makeClient: () => createFakeAirtableClient(store) });
    expect(second.status).toBe("success");
    expect(second.stats.created).toBe(0);
    expect(second.stats.updated).toBe(0);
    expect(second.stats.unchanged).toBeGreaterThan(0);
    const writesAfterSecondRun = store.callLog.filter((entry) => entry.method === "upsertRecords" || entry.method === "deleteRecords").length;
    expect(writesAfterSecondRun).toBe(writesBeforeSecondRun);

    await pglite.query("UPDATE sessions SET title = 'Renamed talk' WHERE id = $1", [sessionId]);
    const upsertsBeforeThirdRun = store.callLog.filter((entry) => entry.method === "upsertRecords").length;
    const third = await runAirtableSyncForEventIn(db, eventId, { trigger: "manual", makeClient: () => createFakeAirtableClient(store) });
    expect(third.status).toBe("success");
    expect(third.stats.updated).toBe(1);
    expect(third.stats.created).toBe(0);
    const upsertCallsForThirdRun = store.callLog.filter((entry) => entry.method === "upsertRecords").length - upsertsBeforeThirdRun;
    expect(upsertCallsForThirdRun).toBe(1);
  });

  it("renaming a linked track re-pushes only the track's own row — the link carries a resolved record id, never a denormalized label", async () => {
    // Airtable renders a `multipleRecordLinks` chip from the *linked record's
    // own current primary field*, live — it is not a static copy. So a
    // session's projected 'Track' value (a resolved Airtable record id) is
    // correctly untouched by a track rename: Airtable already shows the new
    // name on every session's link chip without us pushing anything, and
    // pushing the sessions anyway would be redundant writes for free.
    const eventId = eventIdSchema.parse(nextId());
    const trackId = nextId();
    const sessionAId = nextId();
    const sessionBId = nextId();
    await seedEvent(eventId);
    await seedTrack(trackId, eventId, "Platform");
    await seedSession(sessionAId, eventId, { trackId, title: "Talk A" });
    await seedSession(sessionBId, eventId, { trackId, title: "Talk B" });

    const store = createFakeStore();
    await connectEvent(eventId);
    await runAirtableSyncForEventIn(db, eventId, { trigger: "manual", makeClient: () => createFakeAirtableClient(store) });

    await pglite.query("UPDATE tracks SET name = 'Renamed track' WHERE id = $1", [trackId]);
    const outcome = await runAirtableSyncForEventIn(db, eventId, { trigger: "manual", makeClient: () => createFakeAirtableClient(store) });
    expect(outcome.status).toBe("success");
    expect(outcome.stats.updated).toBe(1);
    const tracksTable = tableByName(store, "Tracks");
    const renamed = [...tracksTable.records.values()].find((fields) => fields["Openboard ID"] === trackId);
    expect(renamed?.Name).toBe("Renamed track");
  });

  it("a link target re-created under a new Airtable record id flips the dependent's hash too", async () => {
    const eventId = eventIdSchema.parse(nextId());
    const trackId = nextId();
    const sessionId = nextId();
    await seedEvent(eventId);
    await seedTrack(trackId, eventId, "Platform");
    await seedSession(sessionId, eventId, { trackId });

    const store = createFakeStore();
    await connectEvent(eventId);
    await runAirtableSyncForEventIn(db, eventId, { trigger: "manual", makeClient: () => createFakeAirtableClient(store) });

    // Simulate the track's Airtable record having been deleted and re-created
    // under a new id — the state row for "tracks" now points somewhere new.
    await pglite.query(
      "UPDATE airtable_sync_state SET airtable_record_id = 'recBRANDNEW01' WHERE event_id = $1 AND table_name = 'tracks'",
      [eventId],
    );
    const outcome = await runAirtableSyncForEventIn(db, eventId, { trigger: "manual", makeClient: () => createFakeAirtableClient(store) });
    expect(outcome.status).toBe("success");
    // Only the session's hash flips — the track's own row is untouched, since
    // its state row's record id is what changed, not anything the track
    // itself projects about its own fields.
    expect(outcome.stats.updated).toBe(1);
  });

  it("a torn write — the state row lost after a successful push — re-pushes as an update, never a duplicate", async () => {
    const eventId = eventIdSchema.parse(nextId());
    const trackId = nextId();
    await seedEvent(eventId);
    await seedTrack(trackId, eventId, "Platform");

    const store = createFakeStore();
    await connectEvent(eventId);
    await runAirtableSyncForEventIn(db, eventId, { trigger: "manual", makeClient: () => createFakeAirtableClient(store) });

    const tracksTable = tableByName(store, "Tracks");
    expect(tracksTable.records.size).toBe(1);

    // The write landed in Airtable but the state row never made it — exactly
    // what a crash between the two would leave behind.
    await pglite.query("DELETE FROM airtable_sync_state WHERE event_id = $1 AND table_name = 'tracks'", [eventId]);

    const outcome = await runAirtableSyncForEventIn(db, eventId, { trigger: "manual", makeClient: () => createFakeAirtableClient(store) });
    expect(outcome.status).toBe("success");
    expect(outcome.stats.created).toBe(0);
    expect(outcome.stats.updated).toBe(1);
    // No duplicate: performUpsert matched the existing Airtable record by
    // Openboard ID, so the table still holds exactly one row.
    expect(tracksTable.records.size).toBe(1);
  });

  it("connecting onto a base that already holds our rows costs zero creates, not an adoption scan", async () => {
    const eventId = eventIdSchema.parse(nextId());
    const trackId = nextId();
    await seedEvent(eventId);
    await seedTrack(trackId, eventId, "Platform");

    const store = createFakeStore();
    const built = await buildMatchingSchema(store);
    // A row already sitting in the customer's base, from before this
    // connection existed — `airtable_sync_state` has never heard of it.
    const tracksTable = tableByName(store, "Tracks");
    tracksTable.records.set("recPREEXISTING1", { "Openboard ID": trackId, Name: "Platform (from Airtable)" });

    await connectEvent(eventId, { schema: { snapshot: built.snapshot, fingerprint: built.fingerprint } });
    const outcome = await runAirtableSyncForEventIn(db, eventId, { trigger: "manual", makeClient: () => createFakeAirtableClient(store) });
    expect(outcome.status).toBe("success");
    expect(outcome.stats.created).toBe(0);
    expect(outcome.stats.updated).toBe(1);
    expect(tracksTable.records.size).toBe(1);
    expect(tracksTable.records.has("recPREEXISTING1")).toBe(true);
  });
});

describe("PII gates end to end", () => {
  it("pushes a speaker to People with an email, and turning the gate off clears the pushed column on the next sync", async () => {
    const eventId = eventIdSchema.parse(nextId());
    const contactId = nextId();
    const sessionId = nextId();
    await seedEvent(eventId);
    await seedContact(contactId, eventId, { firstName: "Priya", lastName: "Raman" });
    await seedSession(sessionId, eventId);
    await seedSpeaker(sessionId, eventId, contactId);

    const store = createFakeStore();
    await connectEvent(eventId);
    const first = await runAirtableSyncForEventIn(db, eventId, { trigger: "manual", makeClient: () => createFakeAirtableClient(store) });
    expect(first.status).toBe("success");

    const people = store.tables.get("People");
    if (!people) throw new Error("expected ensureBaseSchema to have created a People table");
    const speakerRecord = [...people.records.values()].find((fields) => fields["Openboard ID"] === contactId);
    expect(speakerRecord?.Name).toBe("Priya Raman");
    expect(speakerRecord?.Email).toContain("@example.com");

    await pglite.query(
      "UPDATE airtable_connections SET options = jsonb_set(options, '{includeEmail}', 'false'), next_sync_after = now() WHERE event_id = $1",
      [eventId],
    );
    const second = await runAirtableSyncForEventIn(db, eventId, { trigger: "manual", makeClient: () => createFakeAirtableClient(store) });
    expect(second.status).toBe("success");
    expect(second.stats.updated).toBe(1);
    const updated = [...people.records.values()].find((fields) => fields["Openboard ID"] === contactId);
    expect(updated?.Email).toBeNull();
  });

  /**
   * Headshots (issue #643). The deferral said an Airtable attachment needs a
   * signed R2 URL refreshed before it expires; it does not. Airtable fetches
   * the bytes once and keeps its own copy, and `headshot` is a public file kind
   * served at a permanent `/f/{fileId}`. What the engine therefore has to get
   * right is exactly what a gated column always had to: land it, don't re-push
   * it every run, and clear it when the organizer says stop.
   */
  it("pushes a speaker's headshot as an attachment, stays quiet on the next run, and clears it when the gate goes off", async () => {
    const eventId = eventIdSchema.parse(nextId());
    const contactId = nextId();
    const sessionId = nextId();
    const fileId = nextId();
    await seedEvent(eventId);
    await seedContact(contactId, eventId, { firstName: "Ines", lastName: "Okafor" });
    await seedSession(sessionId, eventId);
    await seedSpeaker(sessionId, eventId, contactId);
    await pglite.query(
      "INSERT INTO file_assets(id,event_id,kind,r2_key,filename,mime) VALUES($1,$2,'headshot',$3,'ines.jpg','image/jpeg')",
      [fileId, eventId, `evt_${eventId}/headshot/${fileId}/ines.jpg`],
    );
    await pglite.query("UPDATE contacts SET headshot_file_id = $1 WHERE id = $2", [fileId, contactId]);

    const store = createFakeStore();
    await connectEvent(eventId);
    expect((await runAirtableSyncForEventIn(db, eventId, { trigger: "manual", makeClient: () => createFakeAirtableClient(store) })).status).toBe("success");

    const people = tableByName(store, "People");
    expect(people.fields.find((field) => field.name === "Headshot")?.type).toBe("multipleAttachments");
    const speaker = [...people.records.values()].find((fields) => fields["Openboard ID"] === contactId);
    expect(speaker?.Headshot).toEqual([{ url: `${APP_BASE_URL}/f/${fileId}`, filename: "ines.jpg" }]);

    // Every push of this record makes Airtable re-download the photo, so a
    // steady state that keeps writing it is a real cost, not just noise.
    const second = await runAirtableSyncForEventIn(db, eventId, { trigger: "manual", makeClient: () => createFakeAirtableClient(store) });
    expect(second.stats.updated).toBe(0);

    await pglite.query(
      "UPDATE airtable_connections SET options = jsonb_set(options, '{includeHeadshots}', 'false'), next_sync_after = now() WHERE event_id = $1",
      [eventId],
    );
    const third = await runAirtableSyncForEventIn(db, eventId, { trigger: "manual", makeClient: () => createFakeAirtableClient(store) });
    expect(third.stats.updated).toBe(1);
    expect([...people.records.values()].find((fields) => fields["Openboard ID"] === contactId)?.Headshot).toEqual([]);
  });
});

describe("concurrency and leases", () => {
  it("two concurrent runs for the same event: exactly one wins, the other sees CONFLICT", async () => {
    const eventId = eventIdSchema.parse(nextId());
    await seedEvent(eventId);
    const store = createFakeStore();
    await connectEvent(eventId);

    const results = await Promise.allSettled([
      runAirtableSyncForEventIn(db, eventId, { trigger: "manual", makeClient: () => createFakeAirtableClient(store) }),
      runAirtableSyncForEventIn(db, eventId, { trigger: "cron", makeClient: () => createFakeAirtableClient(store) }),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: "CONFLICT" });

    const runs = await listSyncRunsIn(db, eventId, 10);
    expect(runs).toHaveLength(1);
  });
});

describe("bounded work: write caps and deadlines", () => {
  it("a write cap defers the remainder; the next run finishes it, and every row is created exactly once", async () => {
    const eventId = eventIdSchema.parse(nextId());
    await seedEvent(eventId);
    const trackIds = Array.from({ length: 25 }, () => nextId());
    for (const trackId of trackIds) await seedTrack(trackId, eventId, `Track ${trackId.slice(-4)}`);

    const store = createFakeStore();
    await connectEvent(eventId);

    const first = await runAirtableSyncForEventIn(db, eventId, {
      trigger: "manual", writeCap: 10, makeClient: () => createFakeAirtableClient(store),
    });
    expect(first.status).toBe("success");
    expect(first.stats.deferred).toBeGreaterThan(0);
    expect(first.stats.created).toBeLessThan(25);

    const second = await runAirtableSyncForEventIn(db, eventId, {
      trigger: "manual", writeCap: 300, makeClient: () => createFakeAirtableClient(store),
    });
    expect(second.status).toBe("success");
    expect(second.stats.deferred).toBe(0);

    const tracksTable = tableByName(store, "Tracks");
    expect(tracksTable.records.size).toBe(25);
    expect(first.stats.created + second.stats.created).toBe(25);
  });

  it("a deadline mid-table stops cleanly: success, a named deferred remainder, and a released lease", async () => {
    const eventId = eventIdSchema.parse(nextId());
    await seedEvent(eventId);
    // Enough rows that the batch loop writes more than once before the
    // budget check fires — one page, three ten-record batches.
    const trackIds = Array.from({ length: 25 }, () => nextId());
    for (const trackId of trackIds) await seedTrack(trackId, eventId, `Track ${trackId.slice(-4)}`);

    const store = createFakeStore();
    await connectEvent(eventId);

    let calls = 0;
    // The first checkpoint (after the first ten-record batch) still reads as
    // "just started"; the second checkpoint (after the second batch) reads as
    // "out of time" — so the run stops mid-table, having written some but not
    // all of the twenty-five rows.
    const clock = () => { calls += 1; return calls <= 2 ? 0 : 999_999; };
    const outcome = await runAirtableSyncForEventIn(db, eventId, {
      trigger: "manual", now: clock, budgetMs: 1, makeClient: () => createFakeAirtableClient(store),
    });
    expect(outcome.status).toBe("success");
    expect(outcome.stats.deferred).toBeGreaterThan(0);

    const { rows: [row] } = await pglite.query<{ status: string; lease_expires_at: string | null }>(
      "SELECT status, lease_expires_at FROM airtable_sync_runs WHERE event_id = $1", [eventId],
    );
    expect(row?.status).toBe("success");
    expect(row?.lease_expires_at).toBeNull();

    // The lease being released means a fresh run can claim immediately.
    const again = await runAirtableSyncForEventIn(db, eventId, { trigger: "manual", makeClient: () => createFakeAirtableClient(store) });
    expect(again.status).toBe("success");
  });
});

describe("purge: default off, counted always, circuit-broken when it would gut the table", () => {
  it("deleting a source row with pruneRemoved off: no delete call, the orphan is only counted", async () => {
    const eventId = eventIdSchema.parse(nextId());
    const trackId = nextId();
    await seedEvent(eventId);
    await seedTrack(trackId, eventId, "Platform");
    const store = createFakeStore();
    await connectEvent(eventId, { pruneRemoved: false });
    await runAirtableSyncForEventIn(db, eventId, { trigger: "manual", makeClient: () => createFakeAirtableClient(store) });

    await pglite.query("DELETE FROM tracks WHERE id = $1", [trackId]);
    const outcome = await runAirtableSyncForEventIn(db, eventId, { trigger: "manual", makeClient: () => createFakeAirtableClient(store) });
    expect(outcome.status).toBe("success");
    expect(outcome.stats.deleted).toBe(0);
    expect(outcome.stats.orphans).toBe(1);
    expect(store.callLog.some((entry) => entry.method === "deleteRecords")).toBe(false);
  });

  it("deleting a source row with pruneRemoved on: exactly one delete call, the state row is gone", async () => {
    const eventId = eventIdSchema.parse(nextId());
    const trackId = nextId();
    await seedEvent(eventId);
    await seedTrack(trackId, eventId, "Platform");
    const store = createFakeStore();
    await connectEvent(eventId, { pruneRemoved: true });
    await runAirtableSyncForEventIn(db, eventId, { trigger: "manual", makeClient: () => createFakeAirtableClient(store) });

    await pglite.query("DELETE FROM tracks WHERE id = $1", [trackId]);
    const outcome = await runAirtableSyncForEventIn(db, eventId, { trigger: "manual", makeClient: () => createFakeAirtableClient(store) });
    expect(outcome.status).toBe("success");
    expect(outcome.stats.deleted).toBe(1);
    const count = await countRows("SELECT count(*) FROM airtable_sync_state WHERE event_id = $1 AND table_name = 'tracks'", [eventId]);
    expect(count).toBe(0);
  });

  it("the circuit breaker holds a purge that would remove most of a table", async () => {
    const eventId = eventIdSchema.parse(nextId());
    // Twenty rows: the floor (max(10, 20%)) is 10 either way, so deleting
    // fifteen (75%) is unambiguously over it — six of twenty would not be.
    const trackIds = Array.from({ length: 20 }, () => nextId());
    await seedEvent(eventId);
    for (const trackId of trackIds) await seedTrack(trackId, eventId, `Track ${trackId.slice(-4)}`);
    const store = createFakeStore();
    await connectEvent(eventId, { pruneRemoved: true });
    await runAirtableSyncForEventIn(db, eventId, { trigger: "manual", makeClient: () => createFakeAirtableClient(store) });

    const toDelete = trackIds.slice(0, 15);
    for (const trackId of toDelete) await pglite.query("DELETE FROM tracks WHERE id = $1", [trackId]);

    const outcome = await runAirtableSyncForEventIn(db, eventId, { trigger: "manual", makeClient: () => createFakeAirtableClient(store) });
    expect(outcome.status).toBe("success");
    expect(outcome.stats.deleted).toBe(0);
    expect(outcome.stats.purgeHeld).toBe(15);
    expect(store.callLog.some((entry) => entry.method === "deleteRecords")).toBe(false);
  });
});

describe("failure classification: blocked stays off the operator's page, failed does not", () => {
  it("unauthorized: connection needs attention, excluded from the due query, blocked with no captureError", async () => {
    const eventId = eventIdSchema.parse(nextId());
    const trackId = nextId();
    await seedEvent(eventId);
    await seedTrack(trackId, eventId, "Platform");
    const store = createFakeStore();
    const built = await buildMatchingSchema(store);
    await connectEvent(eventId, { schema: { snapshot: built.snapshot, fingerprint: built.fingerprint }, nextSyncAfter: past() });
    scheduleError(store, "unauthorized", 401);

    const outcome = await runAirtableSyncForEventIn(db, eventId, { trigger: "cron", makeClient: () => createFakeAirtableClient(store) });
    expect(outcome.status).toBe("blocked");
    expect(outcome.errorKey).toBe("unauthorized");
    expect(captureErrorMock).not.toHaveBeenCalled();

    const connection = await getAirtableConnectionIn(db, eventId);
    expect(connection?.status).toBe("needs_attention");

    const { eventIds } = await claimDueAirtableConnectionsIn(db, 50);
    expect(eventIds).not.toContain(eventId);

    const runs = await listSyncRunsIn(db, eventId, 1);
    expect(runs[0]?.error).toMatch(/stopped accepting your token/u);
  });

  it("rate_limited mid-run: success, a deferred remainder, and the two-minute backoff", async () => {
    const eventId = eventIdSchema.parse(nextId());
    const trackId = nextId();
    const sessionId = nextId();
    await seedEvent(eventId);
    await seedTrack(trackId, eventId, "Platform");
    await seedSession(sessionId, eventId, {});
    const store = createFakeStore();
    const built = await buildMatchingSchema(store);
    await connectEvent(eventId, { schema: { snapshot: built.snapshot, fingerprint: built.fingerprint } });
    // Let the Tracks upsert land, then rate-limit the Sessions upsert.
    scheduleError(store, "rate_limited", 429, { afterCalls: 1 });

    const outcome = await runAirtableSyncForEventIn(db, eventId, { trigger: "manual", makeClient: () => createFakeAirtableClient(store) });
    expect(outcome.status).toBe("success");
    expect(outcome.stats.deferred).toBeGreaterThan(0);

    const connection = await getAirtableConnectionIn(db, eventId);
    if (!connection) throw new Error("expected the connection to still exist");
    const nextSyncAfter = new Date(connection.nextSyncAfter).getTime();
    expect(nextSyncAfter).toBeGreaterThan(Date.now() + 60_000);
    expect(nextSyncAfter).toBeLessThan(Date.now() + 180_000);
  });

  it("missing schema.bases:write on an empty base: blocked, zero writes, manual instructions surfaced", async () => {
    const eventId = eventIdSchema.parse(nextId());
    const trackId = nextId();
    await seedEvent(eventId);
    await seedTrack(trackId, eventId, "Platform");
    const store = createFakeStore();
    await connectEvent(eventId, { scopes: ["data.records:read", "data.records:write", "schema.bases:read"] });

    const outcome = await runAirtableSyncForEventIn(db, eventId, { trigger: "manual", makeClient: () => createFakeAirtableClient(store) });
    expect(outcome.status).toBe("blocked");
    expect(outcome.errorKey).toBe("missing_scope");
    expect(store.callLog.some((entry) => entry.method === "upsertRecords")).toBe(false);
    const runs = await listSyncRunsIn(db, eventId, 1);
    expect(runs[0]?.error).toMatch(/permissions list/u);
  });
});

/**
 * Where the sync is *writing* is not part of a content hash, so anything that
 * moves the target has to move the state with it. Left to itself, every row
 * diffs clean against a base that has never seen it and the run reports
 * `success` having written nothing — the one failure mode this integration can
 * have that shows an organizer no error at all.
 */
describe("re-targeting: a different base, or a table that moved under us", () => {
  it("re-pointing at a different base fills it, instead of calling every row unchanged", async () => {
    const eventId = eventIdSchema.parse(nextId());
    await seedEvent(eventId);
    await seedTrack(nextId(), eventId, "Platform");
    const baseA = createFakeStore("appFAKEBASEAAA1");
    const baseB = createFakeStore("appFAKEBASEBBB2");
    const client = createMultiBaseAirtableClient([baseA, baseB]);
    const built = await buildMatchingSchema(baseA);
    await connectEvent(eventId, {
      baseId: baseA.baseId,
      schema: { snapshot: built.snapshot, fingerprint: built.fingerprint },
    });

    const first = await runAirtableSyncForEventIn(db, eventId, { trigger: "manual", makeClient: () => client });
    expect(first.status).toBe("success");
    expect(tableByName(baseA, "Tracks").records.size).toBe(1);

    await chooseAirtableBaseIn(db, eventId, { action: "select", baseId: baseB.baseId }, { makeClient: () => client });
    const second = await runAirtableSyncForEventIn(db, eventId, { trigger: "manual", makeClient: () => client });

    expect(second.status).toBe("success");
    expect(tableByName(baseB, "Tracks").records.size).toBe(1);
    const tracks = second.stats.perTable.find((table) => table.key === "tracks");
    expect(tracks?.created).toBe(1);
    expect(tracks?.unchanged).toBe(0);
    // The old base keeps what it was given — it is the organizer's data, and
    // switching away is not a licence to delete anything.
    expect(tableByName(baseA, "Tracks").records.size).toBe(1);
  });

  it("re-selecting the same base keeps the state, so nothing is needlessly re-pushed", async () => {
    const eventId = eventIdSchema.parse(nextId());
    await seedEvent(eventId);
    await seedTrack(nextId(), eventId, "Platform");
    const store = createFakeStore("appFAKEBASESAME");
    const client = createMultiBaseAirtableClient([store]);
    const built = await buildMatchingSchema(store);
    await connectEvent(eventId, {
      baseId: store.baseId,
      schema: { snapshot: built.snapshot, fingerprint: built.fingerprint },
    });
    await runAirtableSyncForEventIn(db, eventId, { trigger: "manual", makeClient: () => client });

    // What the "Rebuild it" button does: re-select the base already attached.
    await chooseAirtableBaseIn(db, eventId, { action: "select", baseId: store.baseId }, { makeClient: () => client });
    store.callLog.length = 0;
    const second = await runAirtableSyncForEventIn(db, eventId, { trigger: "manual", makeClient: () => client });

    expect(second.status).toBe("success");
    expect(store.callLog.some((entry) => entry.method === "upsertRecords")).toBe(false);
  });

  it("a table renamed in Airtable is refilled, not left empty behind a hash written for the old one", async () => {
    const eventId = eventIdSchema.parse(nextId());
    await seedEvent(eventId);
    await seedTrack(nextId(), eventId, "Platform");
    const store = createFakeStore();
    const built = await buildMatchingSchema(store);
    await connectEvent(eventId, { schema: { snapshot: built.snapshot, fingerprint: built.fingerprint } });
    await runAirtableSyncForEventIn(db, eventId, { trigger: "manual", makeClient: () => createFakeAirtableClient(store) });
    expect(tableByName(store, "Tracks").records.size).toBe(1);

    // The organizer renames it. Our name-keyed lookup misses and builds a fresh,
    // empty "Tracks" — which stays empty forever if the old hashes survive.
    const renamed = tableByName(store, "Tracks");
    store.tables.delete("Tracks");
    store.tables.set("Programme tracks", { ...renamed, name: "Programme tracks" });
    await invalidateSchemaSnapshotIn(db, eventId);

    const second = await runAirtableSyncForEventIn(db, eventId, { trigger: "manual", makeClient: () => createFakeAirtableClient(store) });
    expect(second.status).toBe("success");
    expect(tableByName(store, "Tracks").records.size).toBe(1);
    expect(tableByName(store, "Programme tracks").records.size).toBe(1);
  });
});

describe("422s that are the customer's data, not our bug", () => {
  it("a rejected record blocks with an actionable sentence and never pages an operator", async () => {
    const eventId = eventIdSchema.parse(nextId());
    await seedEvent(eventId);
    await seedTrack(nextId(), eventId, "Platform");
    const store = createFakeStore();
    const built = await buildMatchingSchema(store);
    await connectEvent(eventId, { schema: { snapshot: built.snapshot, fingerprint: built.fingerprint } });
    scheduleError(store, "data_rejected", 422);

    const outcome = await runAirtableSyncForEventIn(db, eventId, { trigger: "manual", makeClient: () => createFakeAirtableClient(store) });

    expect(outcome.status).toBe("blocked");
    expect(outcome.errorKey).toBe("records_rejected");
    expect(captureErrorMock).not.toHaveBeenCalled();
    const runs = await listSyncRunsIn(db, eventId, 1);
    expect(runs[0]?.error).toMatch(/two rows in your base sharing one hidden Openboard ID/u);
  });
});

describe("a token that only claimed it could build tables", () => {
  it("records Airtable's 403 against the connection so the panel stops offering a rebuild", async () => {
    const eventId = eventIdSchema.parse(nextId());
    await seedEvent(eventId);
    await seedTrack(nextId(), eventId, "Platform");
    const store = createFakeStore();
    // Airtable reports no scopes for a PAT, so this connection was credited
    // with `schema.bases:write` it does not hold. The first create says so.
    await connectEvent(eventId);
    scheduleError(store, "forbidden", 403, { afterCalls: 1, times: 99 });

    const outcome = await runAirtableSyncForEventIn(db, eventId, { trigger: "manual", makeClient: () => createFakeAirtableClient(store) });

    expect(outcome.status).toBe("blocked");
    expect(outcome.errorKey).toBe("missing_scope");
    expect(captureErrorMock).not.toHaveBeenCalled();
    const connection = await getAirtableConnectionIn(db, eventId);
    expect(connection?.scopes).not.toContain("schema.bases:write");
    expect(connection?.scopes).toContain("data.records:write");
  });
});

describe("backoff and starvation", () => {
  it("a repeatedly failing event backs off and stops being claimed while a healthy sibling still is", async () => {
    await quarantineAllOtherConnections();
    const failingEventId = eventIdSchema.parse(nextId());
    const healthyEventId = eventIdSchema.parse(nextId());
    const failingTrackId = nextId();
    await seedEvent(failingEventId, "Failing");
    await seedEvent(healthyEventId, "Healthy");
    await seedTrack(failingTrackId, failingEventId, "Platform");

    const failingStore = createFakeStore();
    const builtFailing = await buildMatchingSchema(failingStore);
    await connectEvent(failingEventId, { schema: { snapshot: builtFailing.snapshot, fingerprint: builtFailing.fingerprint }, nextSyncAfter: past() });
    await connectEvent(healthyEventId, { nextSyncAfter: past() });

    scheduleError(failingStore, "server", 500, { times: 1 });
    const first = await runAirtableSyncForEventIn(db, failingEventId, { trigger: "cron", makeClient: () => createFakeAirtableClient(failingStore) });
    expect(first.status).toBe("failed");

    const afterOneFailure = await getAirtableConnectionIn(db, failingEventId);
    if (!afterOneFailure) throw new Error("expected the failing connection to still exist");
    expect(afterOneFailure.consecutiveFailures).toBe(1);
    expect(new Date(afterOneFailure.nextSyncAfter).getTime()).toBeGreaterThan(Date.now());

    const { eventIds } = await claimDueAirtableConnectionsIn(db, 50);
    expect(eventIds).toContain(healthyEventId);
    expect(eventIds).not.toContain(failingEventId);
  });

  it("backoff is capped at six hours even after many consecutive failures", async () => {
    const eventId = eventIdSchema.parse(nextId());
    await seedEvent(eventId);
    await connectEvent(eventId);
    const connection = await getAirtableConnectionIn(db, eventId);
    if (!connection) throw new Error("expected the connection to exist");
    await pglite.query("UPDATE airtable_connections SET consecutive_failures = 50 WHERE id = $1", [connection.id]);
    await recordSyncOutcomeIn(db, eventId, { ok: false, errorKey: "airtable_unavailable" });
    const updated = await getAirtableConnectionIn(db, eventId);
    if (!updated) throw new Error("expected the connection to still exist");
    const waitMs = new Date(updated.nextSyncAfter).getTime() - Date.now();
    expect(waitMs).toBeGreaterThan(0);
    expect(waitMs).toBeLessThanOrEqual(6 * 60 * 60 * 1000 + 5_000);
  });
});

describe("the sweep: claiming, budgets, isolation", () => {
  it("claims up to the limit, defers the rest, and claims never-synced connections first", async () => {
    await quarantineAllOtherConnections();
    const eventIds: EventId[] = [];
    for (let index = 0; index < 7; index += 1) {
      const eventId = eventIdSchema.parse(nextId());
      await seedEvent(eventId, `Sweep ${index}`);
      eventIds.push(eventId);
      // The first three have never synced; the rest synced a while ago, in
      // reverse order, so "never-synced first" is a real ordering claim.
      const lastSyncedAt = index < 3 ? null : new Date(Date.now() - (10 - index) * 60_000);
      await connectEvent(eventId, { nextSyncAfter: past(), lastSyncedAt });
    }

    const { eventIds: claimed, deferred } = await claimDueAirtableConnectionsIn(db, 5);
    expect(claimed).toHaveLength(5);
    expect(deferred).toBe(2);
    for (const neverSynced of eventIds.slice(0, 3)) expect(claimed).toContain(neverSynced);
  });

  /**
   * The claim query filters on three things at once —
   * `status = 'connected' AND sync_enabled AND base_id IS NOT NULL` — and every
   * other sweep test here seeds a connection that satisfies all three. So each
   * clause was, individually, load-bearing and untested: dropping any one of
   * them would leave this suite entirely green while the sweep started opening
   * tokens for events an organizer had paused, or for connections that never
   * finished the connect flow and have no base to write to.
   */
  it("excludes paused, half-connected, and attention-needing connections from both the claim and the sweep", async () => {
    await quarantineAllOtherConnections();
    const excluded: { label: string; eventId: EventId }[] = [];
    for (const [label, options] of [
      ["paused", { syncEnabled: false }],
      ["pending", { status: "pending" as const }],
      ["needs attention", { status: "needs_attention" as const }],
    ] satisfies [string, Parameters<typeof connectEvent>[1]][]) {
      const eventId = eventIdSchema.parse(nextId());
      await seedEvent(eventId, `Sweep excluded: ${label}`);
      await seedTrack(nextId(), eventId, "Platform");
      await connectEvent(eventId, { ...options, nextSyncAfter: past() });
      excluded.push({ label, eventId });
    }

    const { eventIds: claimed } = await claimDueAirtableConnectionsIn(db, 10);
    for (const { label, eventId } of excluded) expect(claimed, label).not.toContain(eventId);

    // And the sweep on top of it: nothing claimed means no client is ever made,
    // so no sealed token is opened for any of the three.
    await quarantineAllOtherConnections();
    await pglite.query(
      `UPDATE airtable_connections SET next_sync_after = now() - interval '1 minute' WHERE event_id = ANY($1)`,
      [excluded.map((entry) => entry.eventId)],
    );
    let makeClientCalls = 0;
    const stats = await runDueAirtableSyncsIn(db, {
      cronFlag: "1",
      makeClient: () => { makeClientCalls += 1; return createFakeAirtableClient(createFakeStore()); },
    });
    expect(makeClientCalls).toBe(0);
    expect(stats.airtableEvents ?? 0).toBe(0);
  });

  it("two events are fully isolated: syncing one touches no state row and opens no token belonging to the other", async () => {
    const eventA = eventIdSchema.parse(nextId());
    const eventB = eventIdSchema.parse(nextId());
    const trackA = nextId();
    await seedEvent(eventA, "A");
    await seedEvent(eventB, "B");
    await seedTrack(trackA, eventA, "Only in A");
    const storeA = createFakeStore();
    await connectEvent(eventA);
    await connectEvent(eventB);

    await runAirtableSyncForEventIn(db, eventA, { trigger: "manual", makeClient: () => createFakeAirtableClient(storeA) });

    const count = await countRows("SELECT count(*) FROM airtable_sync_state WHERE event_id = $1", [eventB]);
    expect(count).toBe(0);

    const connectionB = await getAirtableConnectionIn(db, eventB);
    expect(connectionB?.lastSyncedAt).toBeNull();
    expect(connectionB?.consecutiveFailures).toBe(0);
  });

  it("AIRTABLE_CRON off: the sweep reports skippedDisabled and makes zero client calls; manual sync is unaffected", async () => {
    // The assertion below is an exact deep-equal on the whole stats object, and
    // `runDueAirtableSyncsIn` scans the entire table rather than one event — so
    // the fixtures left deliberately due by earlier tests have to be pushed out
    // of the window first, exactly as the two neighbouring sweep tests do.
    await quarantineAllOtherConnections();
    const eventId = eventIdSchema.parse(nextId());
    const trackId = nextId();
    await seedEvent(eventId);
    await seedTrack(trackId, eventId, "Platform");
    const store = createFakeStore();
    await connectEvent(eventId, { nextSyncAfter: past() });

    let makeClientCalls = 0;
    const stats = await runDueAirtableSyncsIn(db, {
      cronFlag: "0",
      makeClient: () => { makeClientCalls += 1; return createFakeAirtableClient(store); },
    });
    expect(stats).toEqual({ airtableSkippedDisabled: 1 });
    expect(makeClientCalls).toBe(0);
    expect(store.callLog).toHaveLength(0);

    const manual = await runAirtableSyncForEventIn(db, eventId, { trigger: "manual", makeClient: () => createFakeAirtableClient(store) });
    expect(manual.status).toBe("success");
  });

  it("with the flag on, the sweep actually syncs due connections and reports real stats", async () => {
    await quarantineAllOtherConnections();
    const eventId = eventIdSchema.parse(nextId());
    const trackId = nextId();
    await seedEvent(eventId);
    await seedTrack(trackId, eventId, "Platform");
    const store = createFakeStore();
    await connectEvent(eventId, { nextSyncAfter: past() });

    const stats = await runDueAirtableSyncsIn(db, { cronFlag: "1", makeClient: () => createFakeAirtableClient(store) });
    expect(stats.airtableEvents).toBe(1);
    expect(stats.airtableCreated).toBeGreaterThan(0);
    expect(stats.airtableSkippedLocked ?? 0).toBe(0);
  });

  /**
   * The claim pushes `next_sync_after` out a full interval before any work
   * starts, which is right for a run that crashes and wrong for one the sweep
   * never began. Without the hand-back, a tenant that keeps landing in the tail
   * syncs every thirty minutes while the card promises fifteen, and nothing
   * anywhere says so.
   */
  it("hands the claim back on an event it never reached, so it is due again on the next tick", async () => {
    await quarantineAllOtherConnections();
    const eventIds: EventId[] = [];
    for (let index = 0; index < 2; index += 1) {
      const eventId = eventIdSchema.parse(nextId());
      await seedEvent(eventId, `Unreached ${index}`);
      await seedTrack(nextId(), eventId, "Platform");
      await connectEvent(eventId, { nextSyncAfter: past() });
      eventIds.push(eventId);
    }

    const store = createFakeStore();
    const stats = await runDueAirtableSyncsIn(db, {
      cronFlag: "1",
      // Spent before the first event, so both are claimed and neither is run.
      sweepBudgetMs: 0,
      makeClient: () => createFakeAirtableClient(store),
    });

    expect(stats.airtableEvents).toBe(0);
    expect(stats.airtableDeferredEvents).toBe(2);
    expect(store.callLog).toHaveLength(0);

    for (const eventId of eventIds) {
      const connection = await getAirtableConnectionIn(db, eventId);
      expect(new Date(connection?.nextSyncAfter ?? 0).getTime()).toBeLessThanOrEqual(Date.now() + 1_000);
    }
    const { eventIds: reclaimed } = await claimDueAirtableConnectionsIn(db, 5);
    for (const eventId of eventIds) expect(reclaimed).toContain(eventId);
  });
});

describe("disconnect and cleanup sweeps", () => {
  it("disconnect deletes the connection and every sync-state row for the event, but keeps run history", async () => {
    const eventId = eventIdSchema.parse(nextId());
    const trackId = nextId();
    await seedEvent(eventId);
    await seedTrack(trackId, eventId, "Platform");
    const store = createFakeStore();
    await connectEvent(eventId);
    await runAirtableSyncForEventIn(db, eventId, { trigger: "manual", makeClient: () => createFakeAirtableClient(store) });

    const result = await disconnectAirtableIn(db, eventId);
    expect(result.disconnected).toBe(true);
    expect(await getAirtableConnectionIn(db, eventId)).toBeNull();
    const stateCount = await countRows("SELECT count(*) FROM airtable_sync_state WHERE event_id = $1", [eventId]);
    expect(stateCount).toBe(0);
    const runs = await listSyncRunsIn(db, eventId, 10);
    expect(runs.length).toBeGreaterThan(0);
  });

  it("prunes an abandoned pending connection untouched for 24 hours, and leaves a connected one alone", async () => {
    const abandonedEventId = eventIdSchema.parse(nextId());
    const connectedEventId = eventIdSchema.parse(nextId());
    await seedEvent(abandonedEventId, "Abandoned");
    await seedEvent(connectedEventId, "Connected");
    const abandonedConnectionId = await connectEvent(abandonedEventId, { status: "pending" });
    await pglite.query(
      "UPDATE airtable_connections SET base_id = NULL, created_at = now() - interval '25 hours', updated_at = now() - interval '25 hours' WHERE id = $1",
      [abandonedConnectionId],
    );
    await connectEvent(connectedEventId);

    const result = await pruneAbandonedAirtableConnectionsIn(db);
    expect(result.deleted).toBe(1);
    expect(await getAirtableConnectionIn(db, abandonedEventId)).toBeNull();
    expect(await getAirtableConnectionIn(db, connectedEventId)).not.toBeNull();
  });

  /**
   * The sweep measures how long the *token* has sat unused, and re-pasting one
   * reuses the row without resetting `created_at`. Keyed on that column, this
   * sweep deleted a credential sealed seconds earlier — an organizer who came
   * back two days later, pasted a fresh token, stepped away before picking a
   * base, and returned to "Paste an Airtable token first" with no explanation.
   */
  it("spares a pending row whose token was re-pasted today, however old the row itself is", async () => {
    const eventId = eventIdSchema.parse(nextId());
    await seedEvent(eventId, "Returning");
    const connectionId = await connectEvent(eventId, { status: "pending" });
    await pglite.query(
      "UPDATE airtable_connections SET base_id = NULL, created_at = now() - interval '30 hours', updated_at = now() - interval '30 hours' WHERE id = $1",
      [connectionId],
    );

    await validateAirtableTokenIn(db, eventId, {
      pat: FAKE_PAT,
      connectedByUserId: null,
      makeClient: () => createFakeAirtableClient(createFakeStore()),
    });

    const result = await pruneAbandonedAirtableConnectionsIn(db);
    expect(result.deleted).toBe(0);
    expect(await getAirtableConnectionIn(db, eventId)).not.toBeNull();
  });
});

describe("validateAirtableTokenIn — what a personal access token is allowed to be", () => {
  /**
   * The bug this pins down was found by pointing the engine at the real API:
   * `GET /v0/meta/whoami` returns a `scopes` array for OAuth access tokens
   * only. A personal access token — the single kind `AIRTABLE_TOKEN_URL` mints
   * and the only kind the connect dialog asks for — answers `{ id, email }`
   * and nothing more. Reading that silence as "no scopes granted" told every
   * organizer with a perfectly-configured token that all three required
   * permissions were missing, and `chooseAirtableBaseIn` refused to create a
   * base. The feature was unreachable for its only supported credential.
   */
  function clientReportingScopes(scopes: string[] | null, email: string | null = "priya@example.com"): AirtableClient {
    return {
      async whoami() { return { userId: "usrREALPAT000001", email, scopes }; },
      async listBases() { return [{ id: "appFAKETEST0001", name: "Fake Base", permissionLevel: "create" }]; },
      async createBase() { throw new Error("not exercised"); },
      async getBaseSchema() { throw new Error("not exercised"); },
      async createTable() { throw new Error("not exercised"); },
      async createField() { throw new Error("not exercised"); },
      async upsertRecords() { throw new Error("validateAirtableTokenIn must never write records"); },
      async deleteRecords() { throw new Error("validateAirtableTokenIn must never delete records"); },
      get callCount() { return 0; },
      get rateLimitedCount() { return 0; },
    };
  }

  it("connects a token whose scopes Airtable never reported, rather than declaring all three required ones missing", async () => {
    const eventId = eventIdSchema.parse(nextId());
    await seedEvent(eventId);

    const { verdict, summary } = await validateAirtableTokenIn(db, eventId, {
      pat: FAKE_PAT,
      connectedByUserId: null,
      makeClient: () => clientReportingScopes(null),
    });

    expect(verdict.canConnect).toBe(true);
    expect(verdict.missingRequired).toEqual([]);
    // Base creation and schema repair are the whole point of the create path;
    // an unreported list must not silently downgrade the organizer to typing
    // seven tables out by hand.
    expect(verdict.canManageSchema).toBe(true);
    expect(verdict.scopes).toEqual([...ALL_SCOPES]);
    // And the assumption is persisted, because the sync engine reads
    // `canManageSchema` back off the stored row, not off this verdict.
    expect(summary.scopes).toEqual([...ALL_SCOPES]);
  });

  it("does not claim user.email:read when no email came back", async () => {
    const eventId = eventIdSchema.parse(nextId());
    await seedEvent(eventId);
    const { verdict } = await validateAirtableTokenIn(db, eventId, {
      pat: FAKE_PAT,
      connectedByUserId: null,
      makeClient: () => clientReportingScopes(null, null),
    });
    expect(verdict.canConnect).toBe(true);
    expect(verdict.missingOptional).toEqual(["user.email:read"]);
  });

  it("still believes an explicitly-empty list — an OAuth token really can hold nothing", async () => {
    const eventId = eventIdSchema.parse(nextId());
    await seedEvent(eventId);
    const { verdict } = await validateAirtableTokenIn(db, eventId, {
      pat: FAKE_PAT,
      connectedByUserId: null,
      makeClient: () => clientReportingScopes([]),
    });
    expect(verdict.canConnect).toBe(false);
    expect(verdict.missingRequired).toEqual([...REQUIRED_SCOPES]);
  });
});

describe("markConnectionNeedsAttentionIn", () => {
  it("suspends automatic sync without touching the base id, options, or sync history", async () => {
    const eventId = eventIdSchema.parse(nextId());
    await seedEvent(eventId);
    await connectEvent(eventId);
    await markConnectionNeedsAttentionIn(db, eventId, "unauthorized");
    const connection = await getAirtableConnectionIn(db, eventId);
    expect(connection?.status).toBe("needs_attention");
    expect(connection?.baseId).toBe("appFAKETEST0001");
    expect(connection?.lastErrorKey).toBe("unauthorized");
  });
});
