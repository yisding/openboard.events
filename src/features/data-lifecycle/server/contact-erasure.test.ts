import { readFileSync, readdirSync } from "node:fs";
import { Table, getTableName, is } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as schema from "@/db/schema";

/**
 * The one thing `tests/integration/data-lifecycle.test.ts` structurally cannot
 * check: that the erasure still reaches *everything*.
 *
 * That suite asserts, table by table, that the rows it seeded are gone — a
 * fixture written against the schema as it stood the day it was written. A
 * migration that adds a new table hanging off `contacts` adds no fixture rows,
 * so every assertion there keeps passing while a fresh store of somebody's
 * personal data quietly falls outside a right-to-erasure request. That failure
 * is invisible by construction, and `docs/legal/dpa.md` points a reader at
 * `eraseContactDataIn`'s comment as the authoritative list of what erasure
 * covers.
 *
 * So this reads the authoritative source — the applied SQL, per DECISIONS.md's
 * "Migration authorship" — and requires every table with a foreign key into
 * `contacts` to be a decision somebody made: either named in the erasure
 * function, or on the reviewed list below.
 */
const MIGRATIONS = new URL("../../../../drizzle/", import.meta.url);
const erasureSource = readFileSync(new URL("./contact-erasure.ts", import.meta.url), "utf8");

/**
 * Tables the database's own `ON DELETE` action fully resolves, carrying nothing
 * a receipt line would meaningfully account for.
 *
 * `eraseContactDataIn` writes explicit statements even where a cascade would do
 * the work, for the two reasons its doc comment gives: resilience if a cascade
 * is ever narrowed, and a per-table row count for the receipt. These three are
 * where that second reason does not apply — none of them stores anything the
 * data subject wrote or that identifies them beyond the `contact_id` that is
 * about to stop existing:
 *
 * - `submission_limit_guards` — a per-form counter (CASCADE).
 * - `submission_status_revisions.actor_contact_id` — who moved a submission
 *   between states (SET NULL); the revision itself belongs to the submission,
 *   which may be another person's.
 * - `user_contact_links` — the account↔contact join (CASCADE).
 *
 * Anything else that turns up here is a new personal-data store and needs a
 * statement in the erasure, not an entry on this list.
 */
const CASCADE_ONLY = new Set(["submission_limit_guards", "submission_status_revisions", "user_contact_links"]);

/** Every table declaring a foreign key into `contacts`, across the whole applied chain. */
function tablesReferencingContacts(): Set<string> {
  const referencing = new Set<string>();
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql")).sort()) {
    let creating: string | null = null;
    for (const line of readFileSync(new URL(file, MIGRATIONS), "utf8").split("\n")) {
      const created = /^CREATE TABLE (?:IF NOT EXISTS )?"?([a-z0-9_]+)"?/.exec(line);
      if (created?.[1]) creating = created[1];
      if (/REFERENCES\s+(?:public\.)?"?contacts"?\s*\(/.test(line)) {
        const altered = /^ALTER TABLE "?([a-z0-9_]+)"?/.exec(line);
        const owner = altered?.[1] ?? creating;
        if (owner && owner !== "contacts") referencing.add(owner);
      }
      if (/^\s*\)/.test(line)) creating = null;
    }
  }
  return referencing;
}

function drizzleIdentifiersBySqlName(): Map<string, string> {
  const byName = new Map<string, string>();
  for (const [identifier, value] of Object.entries(schema)) {
    if (is(value, Table)) byName.set(getTableName(value), identifier);
  }
  return byName;
}

describe("contact erasure coverage", () => {
  it("reaches every table that references a contact, or says why it does not", () => {
    const identifiers = drizzleIdentifiersBySqlName();
    const unreached = [...tablesReferencingContacts()]
      .filter((table) => !CASCADE_ONLY.has(table))
      .filter((table) => {
        const identifier = identifiers.get(table);
        // A table with no drizzle export cannot be reached by this function at
        // all, so it is unreached by definition.
        return identifier === undefined || !new RegExp(`\\b${identifier}\\b`).test(erasureSource);
      })
      .sort();

    expect(unreached, "a new table hanging off `contacts` needs an erasure statement or a reviewed exemption").toEqual([]);
  });

  it("keeps the exemption list honest — nothing on it has left the schema", () => {
    const referencing = tablesReferencingContacts();
    // A stale exemption is how a list like this rots into a rubber stamp: the
    // table is renamed, the entry stops matching anything, and the next table
    // to inherit the name is silently exempt.
    expect([...CASCADE_ONLY].filter((table) => !referencing.has(table))).toEqual([]);
  });

  /**
   * The organization-scoped half of the erasure (step 5) reaches a second
   * identity — `organization_contacts` — that no foreign key connects to
   * `contacts` at all, which is exactly why nothing above would catch a gap in
   * it. Its satellites are where the person's name, notes, timeline and merge
   * snapshots actually live.
   */
  it("reaches every table hanging off the organization-level identity", () => {
    const identifiers = drizzleIdentifiersBySqlName();
    const satellites = [...identifiers.keys()]
      .filter((table) => table.startsWith("organization_contact") && table !== "organization_contacts")
      // Admin-authored definitions, not one person's data: a custom field, a
      // tag and a saved segment all outlive any contact they were applied to.
      .filter((table) => !["organization_contact_custom_fields", "organization_contact_tags", "organization_contact_segments"].includes(table))
      // A merge recovery is undo state for the merge audit this erasure
      // deletes; it is keyed on the merge, not on a contact.
      .filter((table) => table !== "organization_contact_merge_recoveries");

    const unreached = satellites
      .filter((table) => {
        const identifier = identifiers.get(table);
        return identifier === undefined || !new RegExp(`\\b${identifier}\\b`).test(erasureSource);
      })
      .sort();

    expect(unreached).toEqual([]);
  });
});
