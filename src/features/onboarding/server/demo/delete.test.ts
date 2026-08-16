import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbOrTx, TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import { createEventIn } from "@/features/events";
import { createOrganizationIn } from "@/features/organizations";
import { eventIdSchema, organizationIdSchema, userIdSchema, type EventId, type OrganizationId, type UserId } from "@/shared/contracts";
import { applyProductMigrations } from "../../../../../scripts/lib/product-migrations";
import { DEMO_RUNNABLE_PHASES } from "../../demo-schemas";
import { deleteDemoEventForActorIn, deleteDemoEventIn } from "./delete";
import { demoEventId } from "./ids";
import { advanceDemoProvisioningIn } from "./provisioning";

/**
 * First Fair — the product's first destructive event writer.
 *
 * Everything below is a negative test, on purpose. `deleteDemoEventIn` is one
 * statement whose WHERE clause carries all three predicates — the id, the
 * tenant, and `is_demo = true` — so what needs proving is not that it deletes
 * the demo but that there is no argument, and no caller mistake, that makes it
 * delete anything else.
 */

/** Every table that hangs off the demo event, for the orphan sweep. */
const CHILD_TABLES = [
  "tracks", "rooms", "session_formats", "tags", "email_templates", "contacts",
  "forms", "form_sections", "form_fields", "form_versions", "routing_rules",
  "submissions", "submission_participants", "submission_answers", "submission_tags",
  "event_members", "event_demo_tour", "event_tour_steps",
] as const;

describe("deleting a demo event", () => {
  let pglite: PGlite;
  let database: DbOrTx;
  let ownerUserId: UserId;
  let organizerUserId: UserId;

  const inTransaction = <T,>(work: (tx: TxDb) => Promise<T>): Promise<T> => work(database as TxDb);

  async function organizationWithDemo(slug: string): Promise<{ organizationId: OrganizationId; eventId: EventId }> {
    const organization = await createOrganizationIn(database, ownerUserId, { name: slug, slug });
    const organizationId = organizationIdSchema.parse(organization.id);
    await database.insert(schema.organizationMembers).values({
      organizationId,
      userId: organizerUserId,
      role: "organizer",
    });
    for (let step = 0; step < DEMO_RUNNABLE_PHASES.length; step += 1) {
      await advanceDemoProvisioningIn(database, ownerUserId, organizationId, { inTransaction });
    }
    return { organizationId, eventId: eventIdSchema.parse(demoEventId(organizationId)) };
  }

  async function eventExists(eventId: string): Promise<boolean> {
    const row = await pglite.query<{ n: number }>("SELECT count(*)::int AS n FROM events WHERE id = $1", [eventId]);
    return (row.rows[0]?.n ?? 0) > 0;
  }

  beforeAll(async () => {
    pglite = new PGlite();
    await applyProductMigrations(pglite);
    database = drizzle(pglite, { schema }) as unknown as DbOrTx;
    const inserted = await pglite.query<{ id: string }>(
      "INSERT INTO users(email,name) VALUES($1,$2),($3,$4) RETURNING id",
      ["demo-delete-owner@test.dev", "Owner", "demo-delete-organizer@test.dev", "Organizer"],
    );
    ownerUserId = userIdSchema.parse(inserted.rows[0]?.id);
    organizerUserId = userIdSchema.parse(inserted.rows[1]?.id);
  }, 180_000);

  afterAll(async () => {
    await pglite.close();
  });

  it("refuses a real event, and leaves the row exactly where it was", async () => {
    const organization = await createOrganizationIn(database, ownerUserId, { name: "Real Org", slug: "real-org" });
    const organizationId = organizationIdSchema.parse(organization.id);
    const real = await createEventIn(database, ownerUserId, {
      name: "A real conference",
      slug: "a-real-conference",
      eventType: "conference",
      timezone: "America/Los_Angeles",
      startsAt: "2099-09-15T16:00:00.000Z",
      endsAt: "2099-09-17T01:00:00.000Z",
    }, organizationId);

    await expect(deleteDemoEventIn(database, organizationId, real.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await eventExists(real.id)).toBe(true);
  });

  it("refuses another organization's demo event", async () => {
    const mine = await organizationWithDemo("delete-tenant-a");
    const theirs = await organizationWithDemo("delete-tenant-b");

    await expect(deleteDemoEventIn(database, mine.organizationId, theirs.eventId))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await eventExists(theirs.eventId)).toBe(true);
    expect(await eventExists(mine.eventId)).toBe(true);
  }, 240_000);

  it("refuses an organizer who is not the owner", async () => {
    const { organizationId, eventId } = await organizationWithDemo("delete-organizer-guard");

    await expect(deleteDemoEventForActorIn(database, organizerUserId, organizationId))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await eventExists(eventId)).toBe(true);
  }, 180_000);

  it("refuses somebody who is not a member of the organization at all", async () => {
    const { organizationId, eventId } = await organizationWithDemo("delete-stranger-guard");
    const [stranger] = await pglite.query<{ id: string }>(
      "INSERT INTO users(email,name) VALUES($1,$2) RETURNING id",
      ["demo-delete-stranger@test.dev", "Stranger"],
    ).then((result) => result.rows);

    await expect(deleteDemoEventForActorIn(database, userIdSchema.parse(stranger?.id), organizationId))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await eventExists(eventId)).toBe(true);
  }, 180_000);

  it("removes the world and leaves no orphan behind when the owner asks", async () => {
    const { organizationId, eventId } = await organizationWithDemo("delete-happy-path");
    await database.insert(schema.eventTourSteps).values({ eventId, stepId: "forms.publish", outcome: "completed" });

    await expect(deleteDemoEventForActorIn(database, ownerUserId, organizationId)).resolves.toEqual({ deleted: true });
    expect(await eventExists(eventId)).toBe(false);

    for (const table of CHILD_TABLES) {
      const row = await pglite.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM ${table} WHERE event_id = $1`,
        [eventId],
      );
      expect({ table, rows: row.rows[0]?.n ?? 0 }).toEqual({ table, rows: 0 });
    }

    const audit = await pglite.query<{ action: string }>(
      "SELECT action FROM organization_audit_log WHERE organization_id = $1",
      [organizationId],
    );
    expect(audit.rows.map((row) => row.action)).toContain("demo.deleted");
  }, 180_000);

  it("says so plainly when there is no demo event to delete", async () => {
    const organization = await createOrganizationIn(database, ownerUserId, { name: "No Demo", slug: "no-demo" });
    await expect(deleteDemoEventForActorIn(database, ownerUserId, organizationIdSchema.parse(organization.id)))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("leaves the demo_provisioned milestone standing — that funnel event really did happen", async () => {
    const { organizationId } = await organizationWithDemo("delete-milestone");
    await deleteDemoEventForActorIn(database, ownerUserId, organizationId);

    const milestones = await pglite.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM organization_onboarding_milestones WHERE organization_id = $1 AND milestone = 'demo_provisioned'",
      [organizationId],
    );
    expect(milestones.rows[0]?.n).toBe(1);
  }, 180_000);
});
