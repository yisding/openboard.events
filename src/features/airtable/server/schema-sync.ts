import type { AirtableSchemaSnapshot } from "@/db/schema";
import {
  SYNCED_TABLE_DESCRIPTION,
  SYNC_TABLE_ORDER,
  TABLE_PLANS,
  type AirtableFieldSpec,
  // The same label the "build these columns by hand" instructions use, so an
  // issue's `expected` and those instructions can never name one column two
  // different ways.
  fieldTypeLabel as describeType,
  linkFields,
  scalarFields,
  tablePlansFingerprint,
} from "../plan";
import type { SchemaIssue } from "../schemas";
import { AirtableError, type AirtableClient, type AirtableTableRef } from "./client";

/**
 * Make the customer's base match `TABLE_PLANS` — create-only, two-pass, and
 * never destructive.
 *
 * The rule that governs everything here: **we never rename, retype, reorder or
 * delete anything in a base we do not own.** A field that exists with the wrong
 * type is reported as an issue with the exact table, field, expected and actual
 * type, and the run ends `blocked` — amber, actionable, no operator page. The
 * alternative (silently "fixing" it) is us deleting a column an organizer built
 * a view on.
 *
 * Two passes, with a re-fetch between them, because creating a
 * `multipleRecordLinks` field auto-creates a symmetric field in the *target*
 * table. A snapshot captured before pass 2 is missing field ids that now exist,
 * and the next run would try to create them again and 422. That re-fetch is not
 * defensive; it is the difference between a base that settles after one run and
 * one that fails on every run.
 */

export type EnsureSchemaResult =
  | {
    ok: true;
    snapshot: AirtableSchemaSnapshot;
    fingerprint: string;
    createdTables: number;
    createdFields: number;
    /**
     * The caller handed us a snapshot we could trust, so no meta call was made
     * and the snapshot returned is byte-for-byte the one already stored. Lets a
     * steady-state run skip re-writing a row it would not change — every fifteen
     * minutes, per connected event.
     */
    fromCache: boolean;
  }
  | {
    ok: false;
    reason: "missing_scope" | "drifted";
    issues: SchemaIssue[];
    /**
     * Airtable answered a create with 403. The caller persists that: the
     * optimistic `schema.bases:write` this token was credited with (Airtable
     * reports no scopes for a PAT) has now been refuted by the API itself.
     */
    schemaWriteDenied?: boolean;
  };

/**
 * Types Airtable may report that still round-trip the value we write.
 *
 * Deliberately lenient: an organizer whose `Description` is a rich-text field
 * rather than long text has a base that works perfectly, and failing their sync
 * over it would be pedantry with a support ticket attached.
 *
 * The test each entry has to pass is *lossless*, not merely "Airtable accepts
 * it". `date` is the case that fails it and is therefore absent: every field we
 * declare as `dateTime` is an instant whose time of day is the point — "Starts
 * at", "Ends at", "Submitted at", "Decided at" — and an Airtable `date` field
 * stores no time component at all. Accepting one meant a session at 14:00 and a
 * session at 09:00 landing indistinguishable in the organizer's own base, with
 * the run reporting success. It is now a `wrongType` issue: amber, named, and
 * repaired by the one person allowed to retype a column in their base.
 */
const TEXT_LIKE = new Set(["singleLineText", "multilineText", "richText", "email", "url", "phoneNumber"]);
const NUMBER_LIKE = new Set(["number", "percent", "duration", "rating", "currency"]);

function typeIsAcceptable(expected: AirtableFieldSpec["type"], actual: string): boolean {
  if (expected === actual) return true;
  if (TEXT_LIKE.has(expected) && TEXT_LIKE.has(actual)) return true;
  if (expected === "number") return NUMBER_LIKE.has(actual);
  return false;
}

function issue(
  kind: SchemaIssue["kind"],
  table: string,
  field: string | null,
  expected: string | null,
  actual: string | null,
  instruction: string,
): SchemaIssue {
  return { kind, table, field, expected, actual, instruction };
}

function indexTables(tables: readonly AirtableTableRef[]): Map<string, AirtableTableRef> {
  return new Map(tables.map((table) => [table.name, table]));
}

function buildSnapshot(tables: readonly AirtableTableRef[]): AirtableSchemaSnapshot {
  const byName = indexTables(tables);
  const snapshot: AirtableSchemaSnapshot = { tables: {} };
  for (const key of SYNC_TABLE_ORDER) {
    const plan = TABLE_PLANS[key];
    const table = byName.get(plan.displayName);
    if (!table) continue;
    snapshot.tables[key] = {
      id: table.id,
      fields: Object.fromEntries(table.fields.map((field) => [field.name, field.id])),
    };
  }
  return snapshot;
}

function snapshotCovers(snapshot: AirtableSchemaSnapshot): boolean {
  return SYNC_TABLE_ORDER.every((key) => {
    const entry = snapshot.tables[key];
    if (!entry) return false;
    return TABLE_PLANS[key].fields.every((field) => entry.fields[field.name] !== undefined);
  });
}

export async function ensureBaseSchema(
  client: AirtableClient,
  input: {
    baseId: string;
    canManageSchema: boolean;
    cached?: { snapshot: AirtableSchemaSnapshot | null; fingerprint: string | null };
  },
): Promise<EnsureSchemaResult> {
  const fingerprint = tablePlansFingerprint();
  const cached = input.cached;
  // The steady-state path: a matching fingerprint over a complete snapshot
  // means a run makes zero meta calls before it starts writing records.
  if (cached?.fingerprint === fingerprint && cached.snapshot && snapshotCovers(cached.snapshot)) {
    return { ok: true, snapshot: cached.snapshot, fingerprint, createdTables: 0, createdFields: 0, fromCache: true };
  }

  let tables = await client.getBaseSchema(input.baseId);
  const issues: SchemaIssue[] = [];
  let createdTables = 0;
  let createdFields = 0;

  /**
   * `canManageSchema` is a *claim*, not a fact — Airtable reports no scopes for
   * a personal access token, so the connect step credits every token with
   * `schema.bases:write` and waits for the first 403 to say otherwise. This is
   * where that 403 lands. Treating it as fatal ended the run `blocked` with no
   * issue list at all and left the panel offering a "Rebuild it" button that
   * could only 403 again; treating it as "this token cannot write schema"
   * downgrades us to the path built for exactly that token — one named
   * instruction per gap, and a field list the organizer can copy.
   */
  let canWrite = input.canManageSchema;
  let writeDenied = false;
  async function tryWrite<T>(work: () => Promise<T>): Promise<T | null> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof AirtableError && error.kind === "forbidden") {
        canWrite = false;
        writeDenied = true;
        return null;
      }
      throw error;
    }
  }

  // Pass 1 — tables and their scalar fields. Link fields cannot be created
  // until every target table exists, so they are deliberately absent here.
  // `tables` is not reassigned until this pass is over, so the index is built
  // once rather than once per table.
  const beforePass1 = indexTables(tables);
  for (const key of SYNC_TABLE_ORDER) {
    const plan = TABLE_PLANS[key];
    const existing = beforePass1.get(plan.displayName);
    if (!existing) {
      const made = canWrite
        ? await tryWrite(() => client.createTable(input.baseId, {
          name: plan.displayName,
          description: SYNCED_TABLE_DESCRIPTION,
          fields: scalarFields(plan),
        }))
        : null;
      if (made) {
        createdTables += 1;
        continue;
      }
      issues.push(issue(
        "missingTable", plan.displayName, null, null, null,
        `Create a table called “${plan.displayName}” with “${plan.primaryField}” as its first field.`,
      ));
      continue;
    }

    const byFieldName = new Map(existing.fields.map((field) => [field.name, field]));
    for (const spec of scalarFields(plan)) {
      const found = byFieldName.get(spec.name);
      if (!found) {
        const made = canWrite ? await tryWrite(() => client.createField(input.baseId, existing.id, spec)) : null;
        if (made) {
          createdFields += 1;
          continue;
        }
        issues.push(issue(
          "missingField", plan.displayName, spec.name, describeType(spec), null,
          `Add a ${describeType(spec)} field called “${spec.name}” to “${plan.displayName}”.`,
        ));
        continue;
      }
      if (!typeIsAcceptable(spec.type, found.type)) {
        // Reported, never repaired: retyping a column in someone else's base
        // can silently discard the values already in it.
        issues.push(issue(
          "wrongType", plan.displayName, spec.name, describeType(spec), found.type,
          `“${spec.name}” in “${plan.displayName}” is a ${found.type} field. Change it to ${describeType(spec)}, or rename it and we'll create ours alongside.`,
        ));
      }
    }
  }

  if (createdTables > 0 || createdFields > 0) tables = await client.getBaseSchema(input.baseId);

  // Pass 2 — links, now that every target table is guaranteed to exist. The
  // index is built once here rather than per table and again per link field:
  // `tables` is only ever reassigned by the two re-fetches, and rebuilding it
  // inside the loops read as though it might change under them.
  const byTableName = indexTables(tables);
  let createdLinks = 0;
  for (const key of SYNC_TABLE_ORDER) {
    const plan = TABLE_PLANS[key];
    const existing = byTableName.get(plan.displayName);
    if (!existing) continue;
    const byFieldName = new Map(existing.fields.map((field) => [field.name, field]));
    for (const spec of linkFields(plan)) {
      const targetName = TABLE_PLANS[spec.linkTo].displayName;
      const target = byTableName.get(targetName);
      const found = byFieldName.get(spec.name);
      if (found) {
        if (!typeIsAcceptable(spec.type, found.type)) {
          issues.push(issue(
            "wrongType", plan.displayName, spec.name, describeType(spec), found.type,
            `“${spec.name}” in “${plan.displayName}” is a ${found.type} field. It needs to link to “${targetName}”.`,
          ));
        } else if (target && found.linkedTableId && found.linkedTableId !== target.id) {
          // Right name, right type, wrong destination. Left unchecked this is
          // the quietest failure in the whole synchronizer: we would write
          // resolved record ids from one table into a link that points at
          // another, and Airtable either rejects every batch or attaches the
          // record that happens to share that id. Reported, never repaired —
          // repointing a link field detaches every record already linked
          // through it.
          issues.push(issue(
            "wrongType", plan.displayName, spec.name, `Link to ${targetName}`, `Link to a different table`,
            `“${spec.name}” in “${plan.displayName}” links to another table. Point it at “${targetName}”, or rename it and we'll create ours alongside.`,
          ));
        }
        continue;
      }
      const made = canWrite && target
        ? await tryWrite(() => client.createField(input.baseId, existing.id, spec, target.id))
        : null;
      if (!made) {
        issues.push(issue(
          "missingField", plan.displayName, spec.name, describeType(spec), null,
          `Add a “${spec.name}” field to “${plan.displayName}” that links to “${TABLE_PLANS[spec.linkTo].displayName}”.`,
        ));
        continue;
      }
      createdLinks += 1;
    }
  }

  // A link field creates a symmetric field in its target table. Without this
  // re-fetch the snapshot is missing ids that already exist, and the next run
  // would try to create them again.
  if (createdLinks > 0) tables = await client.getBaseSchema(input.baseId);
  createdFields += createdLinks;

  // A denied write is a missing scope even though the token claimed to have it,
  // and saying "drifted" there would point the organizer at their base when the
  // thing to fix is their token.
  const gapReason = canWrite ? "drifted" : "missing_scope";
  if (issues.length > 0) {
    return { ok: false, reason: gapReason, issues, ...(writeDenied ? { schemaWriteDenied: true } : {}) };
  }

  const snapshot = buildSnapshot(tables);
  if (!snapshotCovers(snapshot)) {
    // Belt and braces: everything we intended to create reported success but
    // the base still does not carry it. Better a named, amber issue than a
    // stream of 422s on every write.
    const missing: SchemaIssue[] = [];
    for (const key of SYNC_TABLE_ORDER) {
      const plan = TABLE_PLANS[key];
      const entry = snapshot.tables[key];
      if (!entry) {
        missing.push(issue("missingTable", plan.displayName, null, null, null, `Create a table called “${plan.displayName}”.`));
        continue;
      }
      for (const spec of plan.fields) {
        if (entry.fields[spec.name] === undefined) {
          missing.push(issue(
            "missingField", plan.displayName, spec.name, describeType(spec), null,
            `Add a ${describeType(spec)} field called “${spec.name}” to “${plan.displayName}”.`,
          ));
        }
      }
    }
    return { ok: false, reason: gapReason, issues: missing, ...(writeDenied ? { schemaWriteDenied: true } : {}) };
  }

  return { ok: true, snapshot, fingerprint, createdTables, createdFields, fromCache: false };
}
