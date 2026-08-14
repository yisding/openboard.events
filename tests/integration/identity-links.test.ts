import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbOrTx } from "@/db/client";
import * as schema from "@/db/schema";
import { resolveUserContactIn } from "@/features/event-contacts";
import {
  contactIdSchema,
  eventIdSchema,
  userIdSchema,
} from "@/shared/contracts";
import { readProductMigrations } from "../../scripts/lib/product-migrations";

const orgId = "41000000-0000-4000-8000-000000000001";
const eventId = eventIdSchema.parse("41000000-0000-4000-8000-000000000002");
const linkedUserId = userIdSchema.parse("41000000-0000-4000-8000-000000000010");
const unlinkedUserId = userIdSchema.parse("41000000-0000-4000-8000-000000000011");
const ambiguousUserId = userIdSchema.parse("41000000-0000-4000-8000-000000000012");
const occupierUserId = userIdSchema.parse("41000000-0000-4000-8000-000000000013");
const claimedUserId = userIdSchema.parse("41000000-0000-4000-8000-000000000014");
const linkedContactId = contactIdSchema.parse("41000000-0000-4000-8000-000000000020");
const ambiguousEmailContactId = contactIdSchema.parse("41000000-0000-4000-8000-000000000021");
const ambiguousCrmContactId = contactIdSchema.parse("41000000-0000-4000-8000-000000000022");
const occupiedContactId = contactIdSchema.parse("41000000-0000-4000-8000-000000000023");

let pglite: PGlite;
let db: DbOrTx;

describe.sequential("stable user-contact identity links", () => {
  beforeAll(async () => {
    pglite = new PGlite();
    const migrations = readProductMigrations();
    for (const migration of migrations) {
      if (migration.tag === "0041_stable_user_contact_links") break;
      await pglite.exec(migration.sql);
    }

    await pglite.query("INSERT INTO organizations(id,name,slug) VALUES($1,'Identity Org','identity-org')", [orgId]);
    await pglite.query(
      `INSERT INTO events(id,organization_id,name,slug,timezone,starts_at,ends_at)
       VALUES($1,$2,'Identity Event','identity-event','America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')`,
      [eventId, orgId],
    );
    await pglite.query(
      `INSERT INTO users(id,email,name) VALUES
       ($1,'linked@example.com','Linked'),
       ($2,'unlinked@example.com','Unlinked'),
       ($3,'ambiguous@example.com','Ambiguous'),
       ($4,'occupier@example.com','Occupier')`,
      [linkedUserId, unlinkedUserId, ambiguousUserId, occupierUserId],
    );
    await pglite.query(
      `INSERT INTO event_members(user_id,event_id,role) VALUES
       ($1,$5,'reviewer'),($2,$5,'reviewer'),($3,$5,'reviewer'),($4,$5,'reviewer')`,
      [linkedUserId, unlinkedUserId, ambiguousUserId, occupierUserId, eventId],
    );
    await pglite.query(
      `INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES
       ($1,$4,'linked@example.com','Linked','Contact'),
       ($2,$4,'ambiguous@example.com','Email','Candidate'),
       ($3,$4,'changed@example.com','CRM','Candidate')`,
      [linkedContactId, ambiguousEmailContactId, ambiguousCrmContactId, eventId],
    );
    const organizationContactId = "41000000-0000-4000-8000-000000000030";
    await pglite.query(
      `INSERT INTO organization_contacts(id,organization_id,email,first_name,last_name)
       VALUES($1,$2,'ambiguous@example.com','Organization','Identity')`,
      [organizationContactId, orgId],
    );
    await pglite.query(
      `INSERT INTO organization_contact_links(organization_id,organization_contact_id,event_id,contact_id)
       VALUES($1,$2,$3,$4)`,
      [orgId, organizationContactId, eventId, ambiguousCrmContactId],
    );

    const identityMigration = migrations.find((migration) => migration.tag === "0041_stable_user_contact_links");
    if (!identityMigration) throw new Error("identity migration missing");
    await pglite.exec(identityMigration.sql);
    db = drizzle(pglite, { schema }) as unknown as DbOrTx;
  }, 60_000);

  afterAll(async () => pglite.close());

  it("backfills one candidate, records no candidate, and quarantines disagreement", async () => {
    const audits = await pglite.query<{
      user_id: string;
      outcome: string;
      candidate_contact_ids: string[];
      linked_contact_id: string | null;
    }>(
      `SELECT user_id, outcome, candidate_contact_ids, linked_contact_id
       FROM user_contact_link_backfill_audit
       WHERE event_id=$1 ORDER BY user_id`,
      [eventId],
    );
    expect(audits.rows).toEqual([
      {
        user_id: linkedUserId,
        outcome: "linked",
        candidate_contact_ids: [linkedContactId],
        linked_contact_id: linkedContactId,
      },
      {
        user_id: unlinkedUserId,
        outcome: "unlinked",
        candidate_contact_ids: [],
        linked_contact_id: null,
      },
      {
        user_id: ambiguousUserId,
        outcome: "ambiguous",
        candidate_contact_ids: [ambiguousEmailContactId, ambiguousCrmContactId].sort(),
        linked_contact_id: null,
      },
      {
        user_id: occupierUserId,
        outcome: "unlinked",
        candidate_contact_ids: [],
        linked_contact_id: null,
      },
    ]);

    const links = await pglite.query<{ user_id: string; contact_id: string; source: string }>(
      "SELECT user_id, contact_id, source FROM user_contact_links ORDER BY user_id",
    );
    expect(links.rows).toEqual([{ user_id: linkedUserId, contact_id: linkedContactId, source: "backfill" }]);
  });

  it("returns explicit linked, unlinked, and ambiguous outcomes", async () => {
    await expect(resolveUserContactIn(db, eventId, linkedUserId)).resolves.toEqual({
      status: "linked",
      contactId: linkedContactId,
    });
    await expect(resolveUserContactIn(db, eventId, unlinkedUserId)).resolves.toEqual({
      status: "unlinked",
      candidateContactId: null,
    });
    await expect(resolveUserContactIn(db, eventId, ambiguousUserId)).resolves.toEqual({
      status: "ambiguous",
      candidateContactIds: [ambiguousEmailContactId, ambiguousCrmContactId].sort(),
    });
  });

  it("treats a unique email candidate owned by another user as ambiguous", async () => {
    await pglite.query("INSERT INTO users(id,email,name) VALUES($1,'claimed@example.com','Claimed')", [claimedUserId]);
    await pglite.query(
      "INSERT INTO event_members(user_id,event_id,role) VALUES($1,$3,'reviewer'),($2,$3,'reviewer') ON CONFLICT DO NOTHING",
      [claimedUserId, occupierUserId, eventId],
    );
    await pglite.query(
      "INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES($1,$2,'claimed@example.com','Claimed','Contact')",
      [occupiedContactId, eventId],
    );
    await pglite.query(
      "INSERT INTO user_contact_links(user_id,event_id,contact_id,source) VALUES($1,$2,$3,'operator')",
      [occupierUserId, eventId, occupiedContactId],
    );

    await expect(resolveUserContactIn(db, eventId, claimedUserId)).resolves.toEqual({
      status: "ambiguous",
      candidateContactIds: [occupiedContactId],
    });
  });

  it("erases only the stable relationship with either independently owned identity", async () => {
    await pglite.query("DELETE FROM contacts WHERE id=$1 AND event_id=$2", [linkedContactId, eventId]);
    expect((await pglite.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM user_contact_links WHERE user_id=$1 AND event_id=$2",
      [linkedUserId, eventId],
    )).rows).toEqual([{ count: 0 }]);
    expect((await pglite.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM users WHERE id=$1",
      [linkedUserId],
    )).rows).toEqual([{ count: 1 }]);

    await pglite.query("DELETE FROM users WHERE id=$1", [occupierUserId]);
    expect((await pglite.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM contacts WHERE id=$1 AND event_id=$2",
      [occupiedContactId, eventId],
    )).rows).toEqual([{ count: 1 }]);
    expect((await pglite.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM user_contact_links WHERE contact_id=$1 AND event_id=$2",
      [occupiedContactId, eventId],
    )).rows).toEqual([{ count: 0 }]);
  });
});
