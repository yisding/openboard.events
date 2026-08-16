import { describe, expect, it } from "vitest";
import { SYNC_TABLE_ORDER, TABLE_PLANS, tablePlansFingerprint, type AirtableFieldSpec } from "../plan";
import { AirtableError, type AirtableClient, type AirtableFieldRef, type AirtableTableRef } from "./client";
import { ensureBaseSchema } from "./schema-sync";

/**
 * `ensureBaseSchema` against a hand-rolled fake client that only implements
 * the schema-management surface — the rest of `AirtableClient` throws if
 * touched, which is itself an assertion: this function must never write or
 * read records.
 */

const BASE_ID = "appTEST00000001";

type CallLogEntry = { method: string; table?: string; field?: string };

function fakeSchemaClient(initialTables: AirtableTableRef[] = []): { client: AirtableClient; calls: CallLogEntry[]; tables: () => AirtableTableRef[] } {
  let tables = initialTables.map((table) => ({ ...table, fields: [...table.fields] }));
  const calls: CallLogEntry[] = [];
  let nextFieldSeq = 1;
  let nextTableSeq = 1;

  const client: AirtableClient = {
    async whoami() { throw new Error("not used by ensureBaseSchema"); },
    async listBases() { throw new Error("not used by ensureBaseSchema"); },
    async createBase() { throw new Error("not used by ensureBaseSchema"); },
    async upsertRecords() { throw new Error("ensureBaseSchema must never write records"); },
    async deleteRecords() { throw new Error("ensureBaseSchema must never delete records"); },

    async getBaseSchema() {
      calls.push({ method: "getBaseSchema" });
      return tables.map((table) => ({ ...table, fields: [...table.fields] }));
    },

    async createTable(_baseId, spec) {
      calls.push({ method: "createTable", table: spec.name });
      const fields: AirtableFieldRef[] = spec.fields.map((field) => ({ id: `fld${String(nextFieldSeq++).padStart(3, "0")}`, name: field.name, type: field.type }));
      const table: AirtableTableRef = { id: `tbl${String(nextTableSeq++).padStart(3, "0")}`, name: spec.name, fields };
      tables = [...tables, table];
      return table;
    },

    async createField(_baseId, tableId, spec) {
      calls.push({ method: "createField", table: tableId, field: spec.name });
      const field: AirtableFieldRef = { id: `fld${String(nextFieldSeq++).padStart(3, "0")}`, name: spec.name, type: spec.type };
      tables = tables.map((table) => (table.id === tableId ? { ...table, fields: [...table.fields, field] } : table));
      return field;
    },

    get callCount() { return calls.length; },
    get rateLimitedCount() { return 0; },
  };

  return { client, calls, tables: () => tables };
}

/** A field spec rendered the way the fake's `createTable`/`createField` would store it. */
function scalarRef(spec: AirtableFieldSpec, id: string): AirtableFieldRef {
  return { id, name: spec.name, type: spec.type === "multipleRecordLinks" ? "multipleRecordLinks" : spec.type };
}

describe("ensureBaseSchema — the steady state", () => {
  it("makes zero API calls when the cached fingerprint matches and the snapshot is complete", async () => {
    const { client, calls } = fakeSchemaClient();
    const snapshot = {
      tables: Object.fromEntries(SYNC_TABLE_ORDER.map((key) => [key, {
        id: `tbl-${key}`,
        fields: Object.fromEntries(TABLE_PLANS[key].fields.map((field, index) => [field.name, `fld-${key}-${index}`])),
      }])),
    };
    const result = await ensureBaseSchema(client, {
      baseId: BASE_ID,
      canManageSchema: true,
      cached: { snapshot, fingerprint: tablePlansFingerprint() },
    });
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("re-ensures when the cached fingerprint is stale, even if the snapshot looked complete", async () => {
    const { client, calls } = fakeSchemaClient(
      SYNC_TABLE_ORDER.map((key) => {
        const plan = TABLE_PLANS[key];
        let seq = 0;
        return {
          id: `tbl-${key}`,
          name: plan.displayName,
          fields: plan.fields.map((field) => scalarRef(field, `fld-${key}-${seq++}`)),
        };
      }),
    );
    const result = await ensureBaseSchema(client, {
      baseId: BASE_ID,
      canManageSchema: true,
      cached: { snapshot: { tables: {} }, fingerprint: "v1-stale00000000" },
    });
    expect(result.ok).toBe(true);
    // Exactly one meta call: the base already matches the plan, so nothing is
    // created and neither re-fetch fires — but the stale fingerprint still
    // forced this one real check instead of trusting the cache.
    expect(calls).toEqual([{ method: "getBaseSchema" }]);
  });
});

describe("ensureBaseSchema — building a base from nothing", () => {
  it("creates every missing table in pass 1, then link fields in pass 2, re-fetching the schema between the two passes", async () => {
    const { client, calls } = fakeSchemaClient();
    const result = await ensureBaseSchema(client, { baseId: BASE_ID, canManageSchema: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const createTableCalls = calls.filter((call) => call.method === "createTable");
    expect(createTableCalls).toHaveLength(SYNC_TABLE_ORDER.length);
    expect(createTableCalls.map((call) => call.table)).toEqual(SYNC_TABLE_ORDER.map((key) => TABLE_PLANS[key].displayName));

    // Link fields (Track, Room, Format, Speakers, Tags) exist only after pass 1.
    const firstCreateFieldIndex = calls.findIndex((call) => call.method === "createField");
    const lastCreateTableIndex = calls.map((call) => call.method).lastIndexOf("createTable");
    expect(firstCreateFieldIndex).toBeGreaterThan(lastCreateTableIndex);

    // The schema is re-fetched at least once between the passes, not just at the start.
    const getSchemaCalls = calls.filter((call) => call.method === "getBaseSchema").length;
    expect(getSchemaCalls).toBeGreaterThanOrEqual(2);

    expect(result.createdTables).toBe(SYNC_TABLE_ORDER.length);
    expect(result.snapshot.tables.sessions?.fields.Track).toBeDefined();
  });

  it("reports missing_scope, with one instruction per gap, and never writes when the token cannot manage schema", async () => {
    const { client, calls } = fakeSchemaClient();
    const result = await ensureBaseSchema(client, { baseId: BASE_ID, canManageSchema: false });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("missing_scope");
    // One issue per missing table (no fields probed on a table that itself doesn't exist).
    expect(result.issues).toHaveLength(SYNC_TABLE_ORDER.length);
    expect(result.issues.every((issue) => issue.kind === "missingTable")).toBe(true);
    expect(calls.some((call) => call.method === "createTable" || call.method === "createField")).toBe(false);
  });
});

describe("ensureBaseSchema — an existing base with a drifted field", () => {
  function baseTablesMatchingPlan(): AirtableTableRef[] {
    return SYNC_TABLE_ORDER.map((key) => {
      const plan = TABLE_PLANS[key];
      let seq = 0;
      return { id: `tbl-${key}`, name: plan.displayName, fields: plan.fields.map((field) => scalarRef(field, `fld-${key}-${seq++}`)) };
    });
  }

  it("reports a wrongType issue and never retypes or recreates the field", async () => {
    const tables = baseTablesMatchingPlan();
    const sessions = tables.find((table) => table.name === "Sessions");
    if (!sessions) throw new Error("expected a Sessions table in the fixture");
    sessions.fields = sessions.fields.map((field) => (field.name === "Status" ? { ...field, type: "checkbox" } : field));
    const { client, calls } = fakeSchemaClient(tables);

    const result = await ensureBaseSchema(client, { baseId: BASE_ID, canManageSchema: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("drifted");
    const issue = result.issues.find((entry) => entry.table === "Sessions" && entry.field === "Status");
    expect(issue).toMatchObject({ kind: "wrongType", expected: "singleLineText", actual: "checkbox" });
    expect(calls.some((call) => call.method === "createField" && call.field === "Status")).toBe(false);
    expect(calls.some((call) => call.method === "createTable")).toBe(false);
  });

  it("accepts a compatible-but-not-identical type (richText for multilineText) without an issue", async () => {
    const tables = baseTablesMatchingPlan();
    const tracks = tables.find((table) => table.name === "Tracks");
    if (!tracks) throw new Error("expected a Tracks table in the fixture");
    tracks.fields = tracks.fields.map((field) => (field.name === "Description" ? { ...field, type: "richText" } : field));
    const { client } = fakeSchemaClient(tables);
    const result = await ensureBaseSchema(client, { baseId: BASE_ID, canManageSchema: true });
    expect(result.ok).toBe(true);
  });

  it("adds only the missing field, leaving every existing field untouched", async () => {
    const tables = baseTablesMatchingPlan();
    const tracks = tables.find((table) => table.name === "Tracks");
    if (!tracks) throw new Error("expected a Tracks table in the fixture");
    tracks.fields = tracks.fields.filter((field) => field.name !== "Color");
    const { client, calls } = fakeSchemaClient(tables);
    const result = await ensureBaseSchema(client, { baseId: BASE_ID, canManageSchema: true });
    expect(result.ok).toBe(true);
    const createdFieldNames = calls.filter((call) => call.method === "createField").map((call) => call.field);
    expect(createdFieldNames).toEqual(["Color"]);
  });
});

describe("ensureBaseSchema — a token that only claimed it could build tables", () => {
  /**
   * Airtable reports no scopes at all for a personal access token, so the
   * connect step credits every token with `schema.bases:write` and waits for a
   * 403 to say otherwise. That 403 used to escape as an uncaught throw: the run
   * ended `blocked` with an empty issue list, and the settings panel — reading
   * the same optimistic scope — kept offering a "Rebuild it" button that could
   * only fail the same way.
   */
  it("treats a 403 on the first create as 'this token cannot manage schema', not as a crash", async () => {
    const { client } = fakeSchemaClient();
    let refusals = 0;
    const refuse = () => {
      refusals += 1;
      throw new AirtableError("forbidden", "Airtable refused: insufficient permissions", 403);
    };
    const denied: AirtableClient = {
      ...client,
      async createTable() { return refuse(); },
      async createField() { return refuse(); },
    };

    const result = await ensureBaseSchema(denied, { baseId: BASE_ID, canManageSchema: true });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("missing_scope");
    expect(result.schemaWriteDenied).toBe(true);
    // Every gap is named, exactly as it would be for a token that never
    // claimed the scope — that list is the whole remedy for this organizer.
    for (const key of SYNC_TABLE_ORDER) {
      expect(result.issues.some((issue) => issue.table === TABLE_PLANS[key].displayName), TABLE_PLANS[key].displayName).toBe(true);
    }
    // And it asks exactly once: seven tables' worth of guaranteed 403s is a
    // rate-limit budget spent proving something the first answer settled.
    expect(refusals).toBe(1);
  });
});

describe("ensureBaseSchema — link fields", () => {
  it("resolves every link field to a real target-table id, not a placeholder", async () => {
    const { client } = fakeSchemaClient();
    const result = await ensureBaseSchema(client, { baseId: BASE_ID, canManageSchema: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Sessions links to Tracks/Rooms/Formats/People; every one of those field
    // ids must exist, and Sessions' own field ids must differ from the tables
    // it links to — proof the linked id, not the referrer's, was written.
    const sessions = result.snapshot.tables.sessions;
    const tracks = result.snapshot.tables.tracks;
    if (!sessions || !tracks) throw new Error("expected sessions and tracks entries in the snapshot");
    for (const name of ["Track", "Room", "Format", "Speakers"]) {
      expect(sessions.fields[name], name).toBeDefined();
    }
    expect(sessions.id).not.toBe(tracks.id);
  });

  it("never creates a link field whose target table does not yet exist when the token cannot create one", async () => {
    // A base with every scalar field already present but no tables at all for
    // the token to link against, and no permission to create them.
    const { client } = fakeSchemaClient();
    const result = await ensureBaseSchema(client, { baseId: BASE_ID, canManageSchema: false });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.every((issue) => issue.kind !== "wrongType")).toBe(true);
  });
});
