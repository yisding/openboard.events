import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbOrTx } from "@/db/client";
import * as schema from "@/db/schema";
import { assertOrganizationCanCreateEventIn, getOrganizationPlanIn } from "@/features/billing/server/entitlements";
import { applyBillingProviderEventIn, StubBillingProviderAdapter } from "@/features/billing/server/provider";
import {
  getOrganizationBillingSummaryIn,
  getOrganizationSubscriptionIn,
  listBillingPlansIn,
  listOrganizationUsageCountersIn,
} from "@/features/billing/server/queries";
import { incrementOrganizationUsageIn } from "@/features/billing/server/usage";
import { createOrganizationIn } from "@/features/organizations";
import { organizationIdSchema, userIdSchema, type OrganizationId } from "@/shared/contracts";

const migration0 = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");
const migrationTenancy = readFileSync(new URL("../../drizzle/0010_organization_tenancy.sql", import.meta.url), "utf8");
const migrationBilling = readFileSync(new URL("../../drizzle/0012_billing_scaffold.sql", import.meta.url), "utf8");
// First Fair — `countOrganizationEventsIn` now filters on `events.is_demo`, so
// the entitlement layer this suite exercises needs the column. 0044 widens
// 0023's milestone CHECK, which is why the milestone table comes along too.
const migrationOnboardingMilestones = readFileSync(new URL("../../drizzle/0023_onboarding_milestones.sql", import.meta.url), "utf8");
const migrationDemoEvents = readFileSync(new URL("../../drizzle/0044_demo_events_and_tour.sql", import.meta.url), "utf8");

/**
 * M49 — billing scaffold. Event rows are inserted directly with raw SQL
 * (`INSERT INTO events(...)`) rather than through `createEventIn`, the same
 * shortcut `organization-tenancy.test.ts` takes — this suite is about the
 * entitlement/metering layer above `events`, not event creation itself, so it
 * only needs the row to exist and carry the right `organization_id`.
 */
async function insertEvent(pglite: PGlite, organizationId: OrganizationId, slug: string): Promise<void> {
  await pglite.query(
    "INSERT INTO events(name,slug,organization_id,timezone,starts_at,ends_at) VALUES($1,$2,$3,'UTC','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
    [slug, slug, organizationId],
  );
}

describe("billing scaffold (M49)", () => {
  let pglite: PGlite;
  let db: DbOrTx;
  let ownerUserId: ReturnType<typeof userIdSchema.parse>;

  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migration0);
    await pglite.exec(migration1);
    await pglite.exec(migrationTenancy);
    await pglite.exec(migrationBilling);
    await pglite.exec(migrationOnboardingMilestones);
    await pglite.exec(migrationDemoEvents);
    db = drizzle(pglite, { schema }) as unknown as DbOrTx;

    // Raw SQL, not `db.insert(schema.users)`: the TS schema's `users` table
    // includes `email_verified`/`image` (M42, `drizzle/0009_product_auth.sql`),
    // which this suite's migration set deliberately doesn't load — this suite
    // is about the billing layer, not product auth, the same shortcut
    // `organization-tenancy.test.ts` takes for its own user rows.
    const inserted = await pglite.query<{ id: string }>(
      "INSERT INTO users(email,name) VALUES($1,$2) RETURNING id",
      ["billing-owner@test.dev", "Owner"],
    );
    ownerUserId = userIdSchema.parse(inserted.rows[0]?.id);
  }, 30_000);

  afterAll(async () => pglite.close());

  it("seeds the plan catalog", async () => {
    const plans = await listBillingPlansIn(db);
    expect(plans.map((plan) => [plan.id, plan.maxEvents, plan.priceCents])).toEqual([
      ["free", 5, 0],
      ["pro", 50, 4900],
      ["enterprise", null, null],
    ]);
  });

  it("gives a brand-new organization a 'free' subscription atomically with its creation", async () => {
    const org = await createOrganizationIn(db, ownerUserId, { name: "Fresh Org", slug: "billing-fresh-org" });
    const subscription = await getOrganizationSubscriptionIn(db, org.id);
    expect(subscription).toMatchObject({ organizationId: org.id, planId: "free", status: "active", provider: "stub" });
  });

  it("pins the seeded default organization to 'enterprise' via the backfill", async () => {
    const defaultOrgId = organizationIdSchema.parse("d3fa0000-0000-4000-8000-000000000001");
    const subscription = await getOrganizationSubscriptionIn(db, defaultOrgId);
    expect(subscription?.planId).toBe("enterprise");
  });

  describe("assertOrganizationCanCreateEventIn — the events-per-org limit", () => {
    it("allows creation under the free plan's cap and blocks at it", async () => {
      const org = await createOrganizationIn(db, ownerUserId, { name: "Capped Org", slug: "billing-capped-org" });
      for (let i = 0; i < 5; i += 1) {
        await expect(assertOrganizationCanCreateEventIn(db, org.id)).resolves.toBeUndefined();
        await insertEvent(pglite, org.id, `capped-org-event-${i}`);
      }
      await expect(assertOrganizationCanCreateEventIn(db, org.id)).rejects.toMatchObject({ code: "LIMIT_REACHED" });
    });

    it("never blocks a plan with maxEvents: null (unlimited)", async () => {
      const org = await createOrganizationIn(db, ownerUserId, { name: "Unlimited Org", slug: "billing-unlimited-org" });
      await pglite.query("UPDATE organization_subscriptions SET plan_id='enterprise' WHERE organization_id=$1", [org.id]);
      for (let i = 0; i < 8; i += 1) await insertEvent(pglite, org.id, `unlimited-org-event-${i}`);
      await expect(assertOrganizationCanCreateEventIn(db, org.id)).resolves.toBeUndefined();
    });

    it("falls back to the free plan's limit, never an unlimited one, if the subscription row is somehow missing", async () => {
      const org = await createOrganizationIn(db, ownerUserId, { name: "Orphan Sub Org", slug: "billing-orphan-sub-org" });
      await pglite.query("DELETE FROM organization_subscriptions WHERE organization_id=$1", [org.id]);
      const plan = await getOrganizationPlanIn(db, org.id);
      expect(plan.id).toBe("free");
      await expect(assertOrganizationCanCreateEventIn(db, org.id)).resolves.toBeUndefined();
    });
  });

  it("computes the billing summary from live plan + live event count + counters", async () => {
    const org = await createOrganizationIn(db, ownerUserId, { name: "Summary Org", slug: "billing-summary-org" });
    await insertEvent(pglite, org.id, "summary-org-event-0");
    await incrementOrganizationUsageIn(db, org.id, "events");
    await incrementOrganizationUsageIn(db, org.id, "events", 2);

    const summary = await getOrganizationBillingSummaryIn(db, org.id);
    expect(summary.plan.id).toBe("free");
    expect(summary.usage.events).toEqual({ used: 1, limit: 5 });
    expect(summary.counters).toEqual([{ organizationId: org.id, metric: "events", count: 3, updatedAt: expect.any(String) }]);

    const counters = await listOrganizationUsageCountersIn(db, org.id);
    expect(counters).toHaveLength(1);
  });

  describe("the provider seam", () => {
    it("applies a verified webhook event to the organization's subscription", async () => {
      const org = await createOrganizationIn(db, ownerUserId, { name: "Webhook Org", slug: "billing-webhook-org" });
      const adapter = new StubBillingProviderAdapter("does-not-matter-here");
      await applyBillingProviderEventIn(db, adapter, {
        type: "subscription.updated",
        organizationId: org.id,
        planId: "pro",
        status: "active",
        providerCustomerId: "cus_123",
        providerSubscriptionId: "sub_123",
      });
      const subscription = await getOrganizationSubscriptionIn(db, org.id);
      expect(subscription).toMatchObject({ planId: "pro", status: "active", provider: "stub", providerCustomerId: "cus_123", providerSubscriptionId: "sub_123", cancelAtPeriodEnd: false });
    });

    it("marks cancelAtPeriodEnd on a subscription.canceled event", async () => {
      const org = await createOrganizationIn(db, ownerUserId, { name: "Cancel Org", slug: "billing-cancel-org" });
      const adapter = new StubBillingProviderAdapter("does-not-matter-here");
      await applyBillingProviderEventIn(db, adapter, { type: "subscription.canceled", organizationId: org.id, planId: "free", status: "canceled" });
      const subscription = await getOrganizationSubscriptionIn(db, org.id);
      expect(subscription).toMatchObject({ status: "canceled", cancelAtPeriodEnd: true });
    });

    it("rejects an event for an organization with no subscription row", async () => {
      const adapter = new StubBillingProviderAdapter("does-not-matter-here");
      const ghostOrgId = organizationIdSchema.parse("b1110000-0000-4000-8000-0000000000ff");
      await expect(applyBillingProviderEventIn(db, adapter, { type: "subscription.updated", organizationId: ghostOrgId, planId: "pro", status: "active" }))
        .rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });
});
