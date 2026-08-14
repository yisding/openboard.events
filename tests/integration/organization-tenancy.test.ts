import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbOrTx } from "@/db/client";
import * as schema from "@/db/schema";
import { authorizeAdmin, authorizeOrganization } from "@/features/auth";
import { listEventsIn } from "@/features/events";
import {
  assignEventToOrganizationIn,
  createOrganizationIn,
  getEventOrganizationIn,
  getEventAccessOverviewIn,
  getOrganizationBySlugIn,
  getOrganizationMemberRoleIn,
  listOrganizationEventsIn,
  listOrganizationEventsForUserIn,
  listOrganizationMemberIdsIn,
  listOrganizationMembersIn,
  listOrganizationsForUserIn,
  listEventAccessMembersIn,
  listManageableEventAccessForMemberIn,
  removeExplicitEventAccessIn,
  removeEventAccessMemberIn,
  removeOrganizationMemberIn,
  resolvePrimaryOrganizationIn,
  setOrganizationMemberIn,
  setExplicitEventAccessIn,
  setEventAccessMemberIn,
} from "@/features/organizations";
import { DEFAULT_ORGANIZATION_ID, eventIdSchema, organizationIdSchema, userIdSchema } from "@/shared/contracts";

/**
 * M43 — organization tenancy.
 *
 * The isolation cases below deliberately mirror the cross-*event* ones in
 * `schema.test.ts` and `auth.test.ts`: the same three questions (does the
 * database refuse a row that mixes two tenants, does a query ever span them,
 * does a guard ever let a member of one act on the other) asked one level up.
 * The fourth question is M43-specific and matters most: does the new layer
 * change what the *event* layer allows? It must not.
 */

const migration0 = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");
// `listEventsIn` selects every `events` column, so the fixture needs the
// migration that added `physical_address` (P3-EMAIL) as well as tenancy.
const migrationEmailCompliance = readFileSync(new URL("../../drizzle/0007_email_compliance.sql", import.meta.url), "utf8");
const migrationTenancy = readFileSync(new URL("../../drizzle/0010_organization_tenancy.sql", import.meta.url), "utf8");
// M49 — `createOrganizationIn`'s CTE now also inserts an `organization_subscriptions`
// row, so every test in this file that calls it needs the table to exist.
const migrationBilling = readFileSync(new URL("../../drizzle/0012_billing_scaffold.sql", import.meta.url), "utf8");

// Two events and three users that exist *before* the tenancy migration runs —
// this is the "existing single-org data" the migration has to backfill.
const legacyEventA = eventIdSchema.parse("c4300000-0000-4000-8000-000000000001");
const legacyEventB = eventIdSchema.parse("c4300000-0000-4000-8000-000000000002");
const ownerUserId = userIdSchema.parse("c4300000-0000-4000-8000-000000000011");
const organizerUserId = userIdSchema.parse("c4300000-0000-4000-8000-000000000012");
const reviewerUserId = userIdSchema.parse("c4300000-0000-4000-8000-000000000013");
// A user with no event membership at all — used to prove that organization
// membership on its own never opens an event.
const outsiderUserId = userIdSchema.parse("c4300000-0000-4000-8000-000000000014");

const identityOf = (userId: typeof ownerUserId, email: string) => ({ userId, email, name: email });

let pglite: PGlite;
let db: DbOrTx;

describe("organization tenancy (M43)", () => {
  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migration0);
    await pglite.exec(migration1);
    await pglite.exec(migrationEmailCompliance);

    // Pre-M43 world: events with no organization column at all.
    await pglite.query(
      "INSERT INTO events(id,name,slug,timezone,starts_at,ends_at) VALUES($1,'Legacy A','legacy-a','America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z'),($2,'Legacy B','legacy-b','America/Los_Angeles','2026-10-15T16:00:00Z','2026-10-17T01:00:00Z')",
      [legacyEventA, legacyEventB],
    );
    await pglite.query(
      "INSERT INTO users(id,email,name) VALUES($1,'owner@example.com','Owner'),($2,'organizer@example.com','Organizer'),($3,'reviewer@example.com','Reviewer'),($4,'outsider@example.com','Outsider')",
      [ownerUserId, organizerUserId, reviewerUserId, outsiderUserId],
    );
    // The owner is a reviewer on one event and an owner on the other: the
    // backfill has to pick the strongest role, not the first row it sees.
    await pglite.query(
      "INSERT INTO event_members(user_id,event_id,role) VALUES($1,$4,'reviewer'),($1,$5,'owner'),($2,$4,'organizer'),($3,$4,'reviewer')",
      [ownerUserId, organizerUserId, reviewerUserId, legacyEventA, legacyEventB],
    );

    await pglite.exec(migrationTenancy);
    await pglite.exec(migrationBilling);
    db = drizzle(pglite, { schema }) as unknown as DbOrTx;
  }, 30_000);

  afterAll(async () => pglite.close());

  describe("the backfill", () => {
    it("puts every pre-existing event in the default organization", async () => {
      const defaultOrg = await getOrganizationBySlugIn(db, "default");
      expect(defaultOrg?.id).toBe(DEFAULT_ORGANIZATION_ID);
      await expect(getEventOrganizationIn(db, legacyEventA)).resolves.toBe(DEFAULT_ORGANIZATION_ID);
      await expect(getEventOrganizationIn(db, legacyEventB)).resolves.toBe(DEFAULT_ORGANIZATION_ID);
      const listed = await listOrganizationEventsIn(db, DEFAULT_ORGANIZATION_ID);
      expect(listed.map((row) => row.slug)).toEqual(["legacy-a", "legacy-b"]);
    });

    it("gives every existing admin default-organization membership at their strongest event role", async () => {
      const members = await listOrganizationMembersIn(db, DEFAULT_ORGANIZATION_ID);
      expect(members.map((member) => [member.email, member.role])).toEqual([
        ["organizer@example.com", "organizer"],
        ["owner@example.com", "owner"],
        ["reviewer@example.com", "reviewer"],
      ]);
    });

    it("does not invent membership for a user who had none", async () => {
      const memberIds = await listOrganizationMemberIdsIn(db, DEFAULT_ORGANIZATION_ID);
      expect(memberIds).not.toContain(outsiderUserId);
    });

    it("keeps the column default so an insert that names no organization still works", async () => {
      const eventId = eventIdSchema.parse("c4300000-0000-4000-8000-000000000021");
      await pglite.query(
        "INSERT INTO events(id,name,slug,timezone,starts_at,ends_at) VALUES($1,'Unqualified','unqualified','UTC','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
        [eventId],
      );
      await expect(getEventOrganizationIn(db, eventId)).resolves.toBe(DEFAULT_ORGANIZATION_ID);
      await pglite.query("DELETE FROM events WHERE id=$1", [eventId]);
    });
  });

  describe("the schema chain", () => {
    it("refuses an event whose organization does not exist, and a null organization", async () => {
      const ghostOrg = "c4300000-0000-4000-8000-0000000000ff";
      await expect(pglite.query(
        "INSERT INTO events(name,slug,organization_id,timezone,starts_at,ends_at) VALUES('Ghost','ghost',$1,'UTC','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
        [ghostOrg],
      )).rejects.toMatchObject({ code: "23503" });
      await expect(pglite.query(
        "INSERT INTO events(name,slug,organization_id,timezone,starts_at,ends_at) VALUES('Null org','null-org',NULL,'UTC','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
      )).rejects.toMatchObject({ code: "23502" });
    });

    it("refuses to delete an organization that still owns events", async () => {
      // 23001 (restrict_violation), not 23503: `ON DELETE RESTRICT` refuses
      // immediately rather than deferring to end-of-statement like NO ACTION.
      await expect(pglite.query("DELETE FROM organizations WHERE id=$1", [DEFAULT_ORGANIZATION_ID]))
        .rejects.toMatchObject({ code: "23001" });
    });

    /**
     * The point of extending the composite chain one level: an
     * organization-scoped table (M47's exports, M49's billing rows) can pin an
     * event to *its own* organization and have the database reject a row that
     * mixes two tenants — the same guarantee
     * `submissions(track_id,event_id) -> tracks(id,event_id)` already gives one
     * level down. The probe table below is shaped exactly as those future
     * tables will be.
     */
    it("lets an organization-scoped child pin its event, and rejects a cross-organization pair", async () => {
      const otherOrg = await createOrganizationIn(db, ownerUserId, { name: "Probe Org", slug: "probe-org" });
      await pglite.exec(`
        CREATE TABLE organization_scoped_probe (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          event_id uuid NOT NULL,
          FOREIGN KEY (event_id, organization_id) REFERENCES events(id, organization_id) ON DELETE CASCADE
        )
      `);
      try {
        await expect(pglite.query(
          "INSERT INTO organization_scoped_probe(organization_id,event_id) VALUES($1,$2)",
          [otherOrg.id, legacyEventA],
        )).rejects.toMatchObject({ code: "23503" });
        await expect(pglite.query(
          "INSERT INTO organization_scoped_probe(organization_id,event_id) VALUES($1,$2)",
          [DEFAULT_ORGANIZATION_ID, legacyEventA],
        )).resolves.toBeDefined();
      } finally {
        await pglite.exec("DROP TABLE organization_scoped_probe");
        await pglite.query("DELETE FROM organizations WHERE id=$1", [otherOrg.id]);
      }
    });
  });

  describe("organization writes", () => {
    it("creates the organization and its first owner in one statement", async () => {
      const created = await createOrganizationIn(db, organizerUserId, { name: "Acme Events" });
      expect(created.slug).toBe("acme-events");
      await expect(getOrganizationMemberRoleIn(db, created.id, organizerUserId)).resolves.toBe("owner");
      await pglite.query("DELETE FROM organizations WHERE id=$1", [created.id]);
    });

    it("rejects a duplicate slug and a reserved one", async () => {
      const created = await createOrganizationIn(db, organizerUserId, { name: "Dupe", slug: "dupe" });
      await expect(createOrganizationIn(db, organizerUserId, { name: "Dupe again", slug: "dupe" }))
        .rejects.toMatchObject({ code: "VALIDATION" });
      await expect(createOrganizationIn(db, organizerUserId, { name: "Admin", slug: "admin" }))
        .rejects.toMatchObject({ code: "VALIDATION" });
      await pglite.query("DELETE FROM organizations WHERE id=$1", [created.id]);
    });

    it("never lets an organization lose its last owner", async () => {
      const org = await createOrganizationIn(db, ownerUserId, { name: "Solo", slug: "solo" });
      await expect(setOrganizationMemberIn(db, org.id, ownerUserId, "organizer")).rejects.toMatchObject({ code: "VALIDATION" });
      await expect(removeOrganizationMemberIn(db, org.id, ownerUserId)).rejects.toMatchObject({ code: "VALIDATION" });

      await expect(setOrganizationMemberIn(db, org.id, organizerUserId, "owner")).resolves.toBe("owner");
      await expect(setOrganizationMemberIn(db, org.id, ownerUserId, "organizer")).resolves.toBe("organizer");
      await removeOrganizationMemberIn(db, org.id, ownerUserId);
      await expect(getOrganizationMemberRoleIn(db, org.id, ownerUserId)).resolves.toBeNull();

      await pglite.query("DELETE FROM organizations WHERE id=$1", [org.id]);
    });

    it("counts the owner set as it is at write time, not as the last member left it", async () => {
      // The two-owner case the guard exists for: each demotion is legal on its
      // own, and the *second* one is what would empty the organization.
      const org = await createOrganizationIn(db, ownerUserId, { name: "Pair", slug: "pair" });
      await expect(setOrganizationMemberIn(db, org.id, organizerUserId, "owner")).resolves.toBe("owner");

      await expect(setOrganizationMemberIn(db, org.id, ownerUserId, "organizer")).resolves.toBe("organizer");
      await expect(setOrganizationMemberIn(db, org.id, organizerUserId, "organizer")).rejects.toMatchObject({ code: "VALIDATION" });
      await expect(removeOrganizationMemberIn(db, org.id, organizerUserId)).rejects.toMatchObject({ code: "VALIDATION" });

      const owners = await listOrganizationMembersIn(db, org.id);
      expect(owners.filter((member) => member.role === "owner")).toHaveLength(1);

      await pglite.query("DELETE FROM organizations WHERE id=$1", [org.id]);
    });

    /**
     * The half of the last-owner guard a single-connection PGlite cannot
     * execute: two owners demoted at the same instant.
     *
     * With the guard written as `EXISTS (SELECT … other.role = 'owner')`, both
     * statements read the pre-concurrency statement snapshot, both see the
     * other owner, both commit, and the organization is left with zero owners
     * — an unrecoverable lockout. What prevents it is the `FOR UPDATE` on the
     * owner set: it serialises the two statements and re-applies
     * `role = 'owner'` to each locked row at its latest committed version, so
     * the loser no longer counts an owner the winner has already demoted.
     *
     * PGlite has one connection, so the interleaving itself is untestable
     * here. What *is* testable, and what actually regresses if someone
     * "simplifies" the CTE away, is that both writers still emit a locking
     * read of the owner set — asserted here against the SQL Drizzle really
     * generates, and against the plan Postgres really chooses for it.
     */
    it("takes a row lock on the owner set in both membership writers", async () => {
      const dialect = new PgDialect();
      const statements: { sql: string; params: unknown[] }[] = [];
      const capturing = {
        execute: async (query: unknown) => {
          statements.push(dialect.sqlToQuery(query as Parameters<typeof dialect.sqlToQuery>[0]));
          return { rows: [{ role: "owner", user_id: ownerUserId }] };
        },
      } as unknown as DbOrTx;

      await setOrganizationMemberIn(capturing, DEFAULT_ORGANIZATION_ID, organizerUserId, "organizer");
      await removeOrganizationMemberIn(capturing, DEFAULT_ORGANIZATION_ID, organizerUserId);
      expect(statements).toHaveLength(2);

      for (const statement of statements) {
        expect(statement.sql).toMatch(/for update/i);
        // Inlined rather than bound, because `EXPLAIN` a plan is what is being
        // asserted and PGlite's parameterised path would plan it generically.
        const inlined = statement.sql.replace(/\$(\d+)/gu, (_match, index: string) => `'${String(statement.params[Number(index) - 1])}'`);
        const plan = await pglite.query<{ "QUERY PLAN": string }>(`EXPLAIN ${inlined}`);
        expect(plan.rows.map((row) => row["QUERY PLAN"]).join("\n")).toContain("LockRows");
      }
    });
  });

  describe("cross-organization isolation", () => {
    it("never lists one organization's events under another", async () => {
      const orgA = await createOrganizationIn(db, ownerUserId, { name: "Tenant A", slug: "tenant-a" });
      const orgB = await createOrganizationIn(db, organizerUserId, { name: "Tenant B", slug: "tenant-b" });
      await assignEventToOrganizationIn(db, legacyEventB, orgA.id);
      try {
        expect((await listOrganizationEventsIn(db, orgA.id)).map((row) => row.slug)).toEqual(["legacy-b"]);
        expect(await listOrganizationEventsIn(db, orgB.id)).toEqual([]);
        expect((await listOrganizationEventsIn(db, DEFAULT_ORGANIZATION_ID)).map((row) => row.slug)).toEqual(["legacy-a"]);
        await expect(getEventOrganizationIn(db, legacyEventB)).resolves.toBe(orgA.id);
      } finally {
        await assignEventToOrganizationIn(db, legacyEventB, DEFAULT_ORGANIZATION_ID);
        await pglite.query("DELETE FROM organizations WHERE id IN ($1,$2)", [orgA.id, orgB.id]);
      }
    });

    /**
     * The hole `listOrganizationEventsIn` above never had, and the legacy
     * `/events` hub did: `listEventsIn` was `select().from(events)` with no
     * WHERE clause at all, and `eventsHubAuth` admits any signed-in admin — so
     * `GET /api/internal/events` handed every account every tenant's event
     * fleet. Harmless while the install was single-tenant; a directory of every
     * customer's events, one signup away, once M44 opened self-serve signup.
     */
    it("keeps the actionable /events list aligned with event-scoped authorization", async () => {
      const orgA = await createOrganizationIn(db, ownerUserId, { name: "Fleet A", slug: "fleet-a" });
      const orgB = await createOrganizationIn(db, outsiderUserId, { name: "Fleet B", slug: "fleet-b" });
      await assignEventToOrganizationIn(db, legacyEventB, orgB.id);
      try {
        // The outsider can see Legacy B in Fleet B's organization directory,
        // but it is not an actionable hub entry until an event owner assigns
        // event-scoped access.
        expect((await listEventsIn(db, outsiderUserId)).map((event) => event.slug)).toEqual([]);
        expect(await listOrganizationEventsForUserIn(db, orgB.id, outsiderUserId)).toEqual([
          expect.objectContaining({ slug: "legacy-b", eventRole: null }),
        ]);

        // The owner is an event member of both legacy events and a member of
        // the default organization; Fleet B is not theirs, but Legacy B still
        // is — via `event_members`, which is what `requireAdmin` reads.
        expect((await listEventsIn(db, ownerUserId, new Date("2026-09-16T12:00:00.000Z"))).map((event) => [event.slug, event.role])).toEqual([
          ["legacy-a", "reviewer"],
          ["legacy-b", "owner"],
        ]);
        expect(await listOrganizationEventsForUserIn(db, orgB.id, ownerUserId)).toEqual([
          expect.objectContaining({ slug: "legacy-b", eventRole: "owner" }),
        ]);

        // Membership of Fleet A gives its owner nothing extra: it holds no
        // events.
        expect((await listEventsIn(db, reviewerUserId)).map((event) => event.slug)).toEqual(["legacy-a"]);
      } finally {
        await assignEventToOrganizationIn(db, legacyEventB, DEFAULT_ORGANIZATION_ID);
        await pglite.query("DELETE FROM organizations WHERE id IN ($1,$2)", [orgA.id, orgB.id]);
      }
    });

    it("orders past actionable events newest-first instead of leading with stale work", async () => {
      await pglite.query(
        "UPDATE events SET starts_at='2025-01-01T12:00:00Z',ends_at='2025-01-02T12:00:00Z' WHERE id=$1",
        [legacyEventA],
      );
      await pglite.query(
        "UPDATE events SET starts_at='2026-06-01T12:00:00Z',ends_at='2026-06-02T12:00:00Z' WHERE id=$1",
        [legacyEventB],
      );
      try {
        expect((await listEventsIn(db, ownerUserId, new Date("2026-08-13T12:00:00.000Z"))).map((event) => event.slug))
          .toEqual(["legacy-b", "legacy-a"]);
      } finally {
        await pglite.query(
          "UPDATE events SET starts_at='2026-09-15T16:00:00Z',ends_at='2026-09-17T01:00:00Z' WHERE id=$1",
          [legacyEventA],
        );
        await pglite.query(
          "UPDATE events SET starts_at='2026-10-15T16:00:00Z',ends_at='2026-10-17T01:00:00Z' WHERE id=$1",
          [legacyEventB],
        );
      }
    });

    /**
     * What `POST /api/internal/events` uses to decide which tenant a legacy
     * create lands in. Must be deterministic — an actor's two events falling
     * into two different organizations because a query returned rows in a
     * different order would be worse than the default it replaced.
     */
    it("resolves a primary organization by role, then age, and nothing for a user with none", async () => {
      const weak = await createOrganizationIn(db, ownerUserId, { name: "Weak Tie", slug: "weak-tie" });
      const strong = await createOrganizationIn(db, ownerUserId, { name: "Strong Tie", slug: "strong-tie" });
      try {
        await setOrganizationMemberIn(db, weak.id, reviewerUserId, "reviewer");
        await setOrganizationMemberIn(db, strong.id, reviewerUserId, "owner");
        // Owner beats reviewer regardless of which membership is older.
        await expect(resolvePrimaryOrganizationIn(db, reviewerUserId)).resolves.toBe(strong.id);
        // The legacy owner is an owner of all three, so the role test ties and
        // age decides: the 0010 backfill's default organization is the oldest
        // membership they have.
        await expect(resolvePrimaryOrganizationIn(db, ownerUserId)).resolves.toBe(DEFAULT_ORGANIZATION_ID);
        await expect(resolvePrimaryOrganizationIn(db, outsiderUserId)).resolves.toBeNull();
      } finally {
        await pglite.query("DELETE FROM organizations WHERE id IN ($1,$2)", [weak.id, strong.id]);
      }
    });

    it("only lists the organizations a user actually belongs to", async () => {
      const orgA = await createOrganizationIn(db, ownerUserId, { name: "Only Mine", slug: "only-mine" });
      try {
        const mine = await listOrganizationsForUserIn(db, ownerUserId);
        expect(mine.map((row) => row.organization.slug).sort()).toEqual(["default", "only-mine"]);
        const theirs = await listOrganizationsForUserIn(db, outsiderUserId);
        expect(theirs).toEqual([]);
      } finally {
        await pglite.query("DELETE FROM organizations WHERE id=$1", [orgA.id]);
      }
    });

    /** The organization-level mirror of `auth.test.ts`'s role-ordering case. */
    it("ranks organization roles on the same ladder and refuses a member of another organization", async () => {
      const orgA = await createOrganizationIn(db, ownerUserId, { name: "Guarded A", slug: "guarded-a" });
      const orgB = await createOrganizationIn(db, outsiderUserId, { name: "Guarded B", slug: "guarded-b" });
      await setOrganizationMemberIn(db, orgA.id, reviewerUserId, "reviewer");
      const owner = identityOf(ownerUserId, "owner@example.com");
      const reviewer = identityOf(reviewerUserId, "reviewer@example.com");
      try {
        await expect(authorizeOrganization(db, owner, orgA.id, "reviewer")).resolves.toMatchObject({ role: "owner", organizationId: orgA.id });
        await expect(authorizeOrganization(db, reviewer, orgA.id, "organizer")).rejects.toMatchObject({ code: "FORBIDDEN" });
        await expect(authorizeOrganization(db, reviewer, orgA.id, "reviewer")).resolves.toMatchObject({ role: "reviewer" });
        await expect(authorizeOrganization(db, owner, orgB.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
      } finally {
        await pglite.query("DELETE FROM organizations WHERE id IN ($1,$2)", [orgA.id, orgB.id]);
      }
    });

    /**
     * The M43 invariant that matters most: the new layer must not widen the old
     * one. Organization membership grants nothing on an event, and event
     * membership grants nothing on an organization.
     */
    it("keeps the per-event contract exactly as it was", async () => {
      const org = await createOrganizationIn(db, outsiderUserId, { name: "No Events", slug: "no-events" });
      const outsider = identityOf(outsiderUserId, "outsider@example.com");
      const organizer = identityOf(organizerUserId, "organizer@example.com");
      try {
        // Owner of an organization, member of no event: still no event access.
        await expect(authorizeOrganization(db, outsider, org.id, "owner")).resolves.toMatchObject({ role: "owner" });
        await expect(authorizeAdmin(db, outsider, legacyEventA)).rejects.toMatchObject({ code: "FORBIDDEN" });

        // Organizer on the event, not a member of that organization: still no
        // organization access — and still full event access.
        await expect(authorizeAdmin(db, organizer, legacyEventA, "organizer")).resolves.toMatchObject({ role: "organizer" });
        await expect(authorizeOrganization(db, organizer, org.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
      } finally {
        await pglite.query("DELETE FROM organizations WHERE id=$1", [org.id]);
      }
    });

    it("scopes a member lookup to one organization", async () => {
      const orgA = await createOrganizationIn(db, ownerUserId, { name: "Scoped A", slug: "scoped-a" });
      const orgB = await createOrganizationIn(db, organizerUserId, { name: "Scoped B", slug: "scoped-b" });
      try {
        await expect(getOrganizationMemberRoleIn(db, orgA.id, organizerUserId)).resolves.toBeNull();
        await expect(getOrganizationMemberRoleIn(db, orgB.id, ownerUserId)).resolves.toBeNull();
        expect((await listOrganizationMembersIn(db, orgA.id)).map((member) => member.email)).toEqual(["owner@example.com"]);
      } finally {
        await pglite.query("DELETE FROM organizations WHERE id IN ($1,$2)", [orgA.id, orgB.id]);
      }
    });

    it("rejects an organization id that is not a uuid before it reaches the database", () => {
      expect(organizationIdSchema.safeParse("not-a-uuid").success).toBe(false);
      expect(organizationIdSchema.safeParse(DEFAULT_ORGANIZATION_ID).success).toBe(true);
    });
  });

  describe("explicit event access management", () => {
    it("requires both organization and event authority, preserves stronger roles, and removes only explicit non-owner access", async () => {
      const otherOrg = await createOrganizationIn(db, ownerUserId, { name: "Access Other", slug: "access-other" });
      const otherEvent = eventIdSchema.parse("c4300000-0000-4000-8000-000000000091");
      await pglite.query(
        "INSERT INTO events(id,organization_id,name,slug,timezone,starts_at,ends_at) VALUES($1,$2,'Other Access Event','other-access-event','UTC','2026-11-15T16:00:00Z','2026-11-17T01:00:00Z')",
        [otherEvent, otherOrg.id],
      );
      await pglite.query(
        "INSERT INTO event_members(user_id,event_id,role) VALUES($1,$2,'organizer'),($1,$3,'organizer')",
        [organizerUserId, legacyEventB, otherEvent],
      );
      try {
        // The organization organizer sees only Legacy A: they organize it.
        // Legacy B is included only after the explicit test fixture above.
        const manageable = await listManageableEventAccessForMemberIn(
          db,
          DEFAULT_ORGANIZATION_ID,
          organizerUserId,
          reviewerUserId,
        );
        expect(manageable.map((row) => [row.eventId, row.role])).toEqual([
          [legacyEventA, "reviewer"],
          [legacyEventB, null],
        ]);

        const grantOverview = await getEventAccessOverviewIn(db, legacyEventB, organizerUserId);
        expect(grantOverview).toMatchObject({ canGrant: true, grantRestriction: null });
        expect(grantOverview.candidates.map((candidate) => candidate.userId)).toEqual([reviewerUserId]);
        await expect(setEventAccessMemberIn(
          db, legacyEventB, organizerUserId, organizerUserId, "reviewer",
        )).rejects.toMatchObject({ code: "VALIDATION" });
        await expect(setEventAccessMemberIn(
          db, legacyEventB, organizerUserId, reviewerUserId, "organizer",
        )).resolves.toMatchObject({ userId: reviewerUserId, role: "organizer", organizationMember: true });
        // A concurrent or stale weaker request reports the stronger truth and
        // never creates a second membership or demotes the first grant.
        await expect(setEventAccessMemberIn(
          db, legacyEventB, organizerUserId, reviewerUserId, "reviewer",
        )).resolves.toMatchObject({ userId: reviewerUserId, role: "organizer" });
        expect((await getEventAccessOverviewIn(db, legacyEventB, organizerUserId)).candidates).toEqual([]);
        await removeEventAccessMemberIn(db, legacyEventB, organizerUserId, reviewerUserId);
        // Replaying a committed removal after a lost response is canonical
        // success, while the actor and owner checks below stay fail-closed.
        await expect(removeEventAccessMemberIn(
          db, legacyEventB, organizerUserId, reviewerUserId,
        )).resolves.toBeUndefined();
        expect((await getEventAccessOverviewIn(db, legacyEventB, organizerUserId)).members)
          .not.toEqual(expect.arrayContaining([expect.objectContaining({ userId: reviewerUserId })]));

        await expect(removeEventAccessMemberIn(
          db, legacyEventA, reviewerUserId, organizerUserId,
        )).rejects.toMatchObject({ code: "FORBIDDEN" });

        await expect(setExplicitEventAccessIn(
          db, DEFAULT_ORGANIZATION_ID, legacyEventA, organizerUserId, reviewerUserId, "organizer",
        )).resolves.toBe("organizer");
        // A weaker repeat never demotes the explicit organizer grant.
        await expect(setExplicitEventAccessIn(
          db, DEFAULT_ORGANIZATION_ID, legacyEventA, organizerUserId, reviewerUserId, "reviewer",
        )).resolves.toBe("organizer");
        await expect(authorizeAdmin(db, identityOf(reviewerUserId, "reviewer@example.com"), legacyEventA, "organizer"))
          .resolves.toMatchObject({ role: "organizer" });
        await expect(getEventAccessOverviewIn(db, legacyEventA, reviewerUserId)).resolves.toMatchObject({
          canGrant: false,
          candidates: [],
          grantRestriction: expect.stringContaining("both this event and its organization"),
        });

        // Event-only authority is fail-closed for reviewers and unrelated actors.
        await expect(removeEventAccessMemberIn(
          db, legacyEventA, outsiderUserId, reviewerUserId,
        )).rejects.toMatchObject({ code: "FORBIDDEN" });

        // Organization ownership is insufficient when the actor is only a
        // reviewer on the event, and a non-member cannot be granted access.
        await expect(setExplicitEventAccessIn(
          db, DEFAULT_ORGANIZATION_ID, legacyEventA, ownerUserId, reviewerUserId, "reviewer",
        )).rejects.toMatchObject({ code: "FORBIDDEN" });
        await expect(setExplicitEventAccessIn(
          db, DEFAULT_ORGANIZATION_ID, legacyEventA, organizerUserId, outsiderUserId, "reviewer",
        )).rejects.toMatchObject({ code: "FORBIDDEN" });

        // Even an event the actor organizes cannot cross the organization id
        // named by the request.
        await expect(setExplicitEventAccessIn(
          db, DEFAULT_ORGANIZATION_ID, otherEvent, organizerUserId, reviewerUserId, "reviewer",
        )).rejects.toMatchObject({ code: "FORBIDDEN" });

        // Existing ownership survives a weaker grant and is never removable
        // through Team access management.
        await expect(setExplicitEventAccessIn(
          db, DEFAULT_ORGANIZATION_ID, legacyEventB, organizerUserId, ownerUserId, "reviewer",
        )).resolves.toBe("owner");
        await expect(removeExplicitEventAccessIn(
          db, DEFAULT_ORGANIZATION_ID, legacyEventB, organizerUserId, ownerUserId,
        )).rejects.toMatchObject({ code: "VALIDATION" });
        await expect(removeExplicitEventAccessIn(
          db, DEFAULT_ORGANIZATION_ID, legacyEventA, organizerUserId, organizerUserId,
        )).rejects.toMatchObject({ code: "VALIDATION" });
        await expect(removeEventAccessMemberIn(
          db, legacyEventB, organizerUserId, ownerUserId,
        )).rejects.toMatchObject({ code: "VALIDATION" });
        await expect(removeEventAccessMemberIn(
          db, legacyEventA, organizerUserId, organizerUserId,
        )).rejects.toMatchObject({ code: "VALIDATION" });

        // Removing organization membership intentionally leaves event access,
        // and Event Settings remains able to show and revoke that former member.
        await removeOrganizationMemberIn(db, DEFAULT_ORGANIZATION_ID, reviewerUserId);
        await expect(listManageableEventAccessForMemberIn(
          db,
          DEFAULT_ORGANIZATION_ID,
          organizerUserId,
          reviewerUserId,
        )).resolves.toEqual([]);
        await expect(getEventAccessOverviewIn(db, legacyEventA, organizerUserId)).resolves.toMatchObject({
          members: expect.arrayContaining([expect.objectContaining({
            userId: reviewerUserId,
            role: "organizer",
            organizationMember: false,
          })]),
        });
        expect(await listEventAccessMembersIn(db, legacyEventA, organizerUserId)).toContainEqual(expect.objectContaining({
          userId: reviewerUserId,
          role: "organizer",
          organizationMember: false,
          canRemove: true,
        }));
        await expect(setExplicitEventAccessIn(
          db, DEFAULT_ORGANIZATION_ID, legacyEventA, organizerUserId, reviewerUserId, "organizer",
        )).rejects.toMatchObject({ code: "FORBIDDEN" });

        await removeEventAccessMemberIn(
          db, legacyEventA, organizerUserId, reviewerUserId,
        );
        await expect(authorizeAdmin(db, identityOf(reviewerUserId, "reviewer@example.com"), legacyEventA))
          .rejects.toMatchObject({ code: "FORBIDDEN" });
      } finally {
        await setOrganizationMemberIn(db, DEFAULT_ORGANIZATION_ID, reviewerUserId, "reviewer");
        await pglite.query(
          "INSERT INTO event_members(user_id,event_id,role) VALUES($1,$2,'reviewer') ON CONFLICT(user_id,event_id) DO UPDATE SET role='reviewer'",
          [reviewerUserId, legacyEventA],
        );
        await pglite.query("DELETE FROM event_members WHERE user_id=$1 AND event_id IN ($2,$3)", [organizerUserId, legacyEventB, otherEvent]);
        await pglite.query("DELETE FROM events WHERE id=$1", [otherEvent]);
        await pglite.query("DELETE FROM organizations WHERE id=$1", [otherOrg.id]);
      }
    });
  });
});
