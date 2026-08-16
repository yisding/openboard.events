import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbOrTx } from "@/db/client";
import * as schema from "@/db/schema";
import { createEventIn } from "@/features/events";
import { createOrganizationIn } from "@/features/organizations";
import { isAppError } from "@/shared/lib/errors";
import { userIdSchema, type OrganizationId, type UserId } from "@/shared/contracts";
import { applyProductMigrations } from "../../../../scripts/lib/product-migrations";
import { assertOrganizationCanCreateEventIn } from "./entitlements";
import {
  countOrganizationDemoEventsIn,
  countOrganizationEventsIn,
  getOrganizationBillingSummaryIn,
  listOrganizationUsageCountersIn,
} from "./queries";

/**
 * First Fair — rail 7: the demo is exempt from the entitlement gate and from
 * metering (design §2.6).
 *
 * The failure mode this retires is specific and nasty: an organization at 5 of
 * 5 events on the free plan is exactly the organization that most needs a
 * ten-minute tour of what it is paying for, and charging a plan slot for a
 * tutorial would make the tour unavailable precisely there. Charging for it
 * also turns "explore the demo" from a reflex into a decision, and produces a
 * support ticket the first time an organizer notices their event count went up
 * without them creating an event.
 *
 * The exemption lives in `countOrganizationEventsIn` — one read, consumed by
 * both `assertOrganizationCanCreateEventIn` and
 * `getOrganizationBillingSummaryIn` — so the gate and the number on the
 * billing page are structurally incapable of disagreeing. That is what the
 * assertions below check: not the predicate, but that both consumers moved.
 */

function eventInput(name: string, slug: string) {
  return {
    name,
    slug,
    eventType: "conference" as const,
    websiteUrl: "",
    location: "",
    physicalAddress: "",
    timezone: "America/Los_Angeles",
    startsAt: "2099-09-15T16:00:00.000Z",
    endsAt: "2099-09-17T01:00:00.000Z",
  };
}

describe("demo events are exempt from the plan limit (First Fair rail 7)", () => {
  let pglite: PGlite;
  let db: DbOrTx;
  let ownerUserId: UserId;

  async function organizationAtCap(slug: string): Promise<OrganizationId> {
    const organization = await createOrganizationIn(db, ownerUserId, { name: slug, slug });
    const organizationId = organization.id;
    for (let index = 1; index <= 5; index += 1) {
      await createEventIn(db, ownerUserId, eventInput(`${slug} event ${index}`, `${slug}-event-${index}`), organizationId);
    }
    return organizationId;
  }

  beforeAll(async () => {
    pglite = new PGlite();
    await applyProductMigrations(pglite);
    db = drizzle(pglite, { schema }) as unknown as DbOrTx;
    const inserted = await pglite.query<{ id: string }>(
      "INSERT INTO users(email,name) VALUES($1,$2) RETURNING id",
      ["demo-billing-owner@test.dev", "Owner"],
    );
    ownerUserId = userIdSchema.parse(inserted.rows[0]?.id);
  }, 180_000);

  afterAll(async () => {
    await pglite.close();
  });

  it("lets an organization at its plan cap still get a demo, and still refuses a sixth real event", async () => {
    const organizationId = await organizationAtCap("capped-org");
    await expect(assertOrganizationCanCreateEventIn(db, organizationId)).rejects.toMatchObject({ code: "LIMIT_REACHED" });

    // The provisioner never calls the entitlement gate, but the demo must also
    // not consume the slot behind its back: the count it would have checked is
    // unchanged afterwards.
    const demoEvent = await createEventIn(
      db,
      ownerUserId,
      eventInput("AI Engineer World's Fair", "capped-org-demo"),
      organizationId,
      { isDemo: true },
    );

    expect(await countOrganizationEventsIn(db, organizationId)).toBe(5);
    expect(await countOrganizationDemoEventsIn(db, organizationId)).toBe(1);
    const stored = await pglite.query<{ is_demo: boolean }>("SELECT is_demo FROM events WHERE id=$1", [demoEvent.id]);
    expect(stored.rows[0]?.is_demo).toBe(true);

    // Exempting the demo must not become a way around the plan.
    const refusal = await assertOrganizationCanCreateEventIn(db, organizationId).catch((error: unknown) => error);
    expect(isAppError(refusal) && refusal.code).toBe("LIMIT_REACHED");
  });

  it("reports the exemption on the billing summary instead of a silently lower number", async () => {
    const organizationId = await organizationAtCap("summary-org");
    await createEventIn(
      db,
      ownerUserId,
      eventInput("AI Engineer World's Fair", "summary-org-demo"),
      organizationId,
      { isDemo: true },
    );

    const summary = await getOrganizationBillingSummaryIn(db, organizationId);
    expect(summary.plan.id).toBe("free");
    // Truthful, not merely lower: six events exist, five of them count.
    expect(summary.usage.events).toEqual({ used: 5, limit: 5 });
    expect(summary.usage.demoEvents).toBe(1);

    // Nothing was metered for the demo, so there is nothing to unwind when the
    // organizer deletes it. `organization_usage_counters` is increment-only.
    expect(await listOrganizationUsageCountersIn(db, organizationId)).toEqual([]);
  });

  it("frees a slot only when a real event is created, never when a demo is", async () => {
    const organization = await createOrganizationIn(db, ownerUserId, { name: "Room to grow", slug: "roomy-org" });
    const organizationId = organization.id;

    await createEventIn(db, ownerUserId, eventInput("Real one", "roomy-real"), organizationId);
    await createEventIn(db, ownerUserId, eventInput("Demo one", "roomy-demo"), organizationId, { isDemo: true });

    expect(await countOrganizationEventsIn(db, organizationId)).toBe(1);
    await expect(assertOrganizationCanCreateEventIn(db, organizationId)).resolves.toBeUndefined();

    const summary = await getOrganizationBillingSummaryIn(db, organizationId);
    expect(summary.usage).toEqual({ events: { used: 1, limit: 5 }, demoEvents: 1 });
  });

  it("counts each organization's demo against only its own tenant", async () => {
    const first = await createOrganizationIn(db, ownerUserId, { name: "Tenant A", slug: "tenant-a" });
    const second = await createOrganizationIn(db, ownerUserId, { name: "Tenant B", slug: "tenant-b" });
    await createEventIn(db, ownerUserId, eventInput("A demo", "tenant-a-demo"), first.id, { isDemo: true });

    expect(await countOrganizationDemoEventsIn(db, first.id)).toBe(1);
    expect(await countOrganizationDemoEventsIn(db, second.id)).toBe(0);
    expect(await countOrganizationEventsIn(db, first.id)).toBe(0);
  });
});
