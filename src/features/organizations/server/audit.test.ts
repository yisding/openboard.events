import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbOrTx } from "@/db/client";
import * as schema from "@/db/schema";
import { createEventIn } from "@/features/events";
import { organizationIdSchema, userIdSchema, type EventId, type OrganizationId, type UserId } from "@/shared/contracts";
import { applyProductMigrations } from "../../../../scripts/lib/product-migrations";
import { createOrganizationIn } from "./mutations";
import { listOrganizationAuditLogIn, recordOrganizationAuditEventIn } from "./audit";

/**
 * MTP-18 §1/§4.33 — an owner reading the audit log after the tutorial ran has
 * to be able to see *which event* it built. The action's metadata has carried
 * the id since the first `demo.provisioned` was written; nothing read it, so
 * the Affected column said "—" on every row that names an event instead of a
 * person.
 */
describe("organization audit log entries that name an event", () => {
  let pglite: PGlite;
  let database: DbOrTx;
  let actorUserId: UserId;
  let organizationId: OrganizationId;
  let eventId: EventId;

  beforeAll(async () => {
    pglite = new PGlite();
    await applyProductMigrations(pglite);
    database = drizzle(pglite, { schema }) as unknown as DbOrTx;
    const inserted = await pglite.query<{ id: string }>(
      "INSERT INTO users(email,name) VALUES($1,$2) RETURNING id",
      ["audit-owner@test.dev", "Owner"],
    );
    actorUserId = userIdSchema.parse(inserted.rows[0]?.id);
    const organization = await createOrganizationIn(database, actorUserId, { name: "Audit Org", slug: "audit-org" });
    organizationId = organizationIdSchema.parse(organization.id);
    const event = await createEventIn(database, actorUserId, {
      name: "First Fair",
      slug: "first-fair",
      eventType: "conference",
      timezone: "America/Los_Angeles",
      startsAt: "2099-09-15T16:00:00.000Z",
      endsAt: "2099-09-17T01:00:00.000Z",
    }, organizationId);
    eventId = event.id;
  }, 180_000);

  afterAll(async () => {
    await pglite.close();
  });

  it("resolves the event a demo action was about, by name", async () => {
    await recordOrganizationAuditEventIn(database, organizationId, actorUserId, "demo.provisioned", null, {
      eventId,
      datasetVersion: 1,
    });

    const [entry] = await listOrganizationAuditLogIn(database, organizationId);

    expect(entry).toMatchObject({
      action: "demo.provisioned",
      targetEventId: eventId,
      targetEventName: "First Fair",
    });
  });

  it("keeps the id of an event that has since been deleted", async () => {
    const goneEventId = "40000000-0000-4000-8000-000000000099";
    await recordOrganizationAuditEventIn(database, organizationId, actorUserId, "demo.deleted", null, {
      eventId: goneEventId,
    });

    const [entry] = await listOrganizationAuditLogIn(database, organizationId);

    expect(entry).toMatchObject({
      action: "demo.deleted",
      targetEventId: goneEventId,
      targetEventName: null,
    });
  });

  it("leaves membership entries — which name a person, not an event — alone", async () => {
    await recordOrganizationAuditEventIn(database, organizationId, actorUserId, "member.removed", actorUserId, {
      role: "organizer",
    });

    const [entry] = await listOrganizationAuditLogIn(database, organizationId);

    expect(entry).toMatchObject({
      action: "member.removed",
      targetEmail: "audit-owner@test.dev",
      targetEventId: null,
      targetEventName: null,
    });
  });

  it("never names another tenant's event, whatever the metadata says", async () => {
    const other = await createOrganizationIn(database, actorUserId, { name: "Other Org", slug: "other-org" });
    const theirs = await createEventIn(database, actorUserId, {
      name: "Somebody Else's Summit",
      slug: "somebody-elses-summit",
      eventType: "conference",
      timezone: "America/Los_Angeles",
      startsAt: "2099-09-15T16:00:00.000Z",
      endsAt: "2099-09-17T01:00:00.000Z",
    }, organizationIdSchema.parse(other.id));
    await recordOrganizationAuditEventIn(database, organizationId, actorUserId, "demo.provisioned", null, {
      eventId: theirs.id,
    });

    const [entry] = await listOrganizationAuditLogIn(database, organizationId);

    expect(entry?.targetEventName).toBeNull();
  });

  it("survives metadata whose eventId is not an event id", async () => {
    await recordOrganizationAuditEventIn(database, organizationId, actorUserId, "invitation.accepted", null, {
      eventId: "not-a-uuid",
    });

    const [entry] = await listOrganizationAuditLogIn(database, organizationId);

    expect(entry).toMatchObject({ action: "invitation.accepted", targetEventId: null });
  });
});
