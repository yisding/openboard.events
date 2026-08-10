import { boolean, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { subscriptionStatusEnum } from "./enums";

/**
 * M49 — billing scaffold (`drizzle/0012_billing_scaffold.sql`).
 *
 * Plans/entitlements/metering hung off `organizations`, additive on top of
 * M43's tenancy layer. Three tables:
 *
 * - `billingPlans` — a small, hand-seeded catalog. `id` is a plain `text`
 *   primary key rather than a Postgres enum: adding a plan later is an
 *   `INSERT`, not an `ALTER TYPE … ADD VALUE` (which cannot run inside the
 *   same transaction as other DDL). `maxEvents: null` means unlimited;
 *   `priceCents: null` means custom/"contact us" pricing, distinct from `0`
 *   (free).
 * - `organizationSubscriptions` — exactly one row per organization; the
 *   primary key *is* `organizationId`. `provider` names which
 *   `BillingProviderAdapter` (`src/features/billing/server/provider.ts`)
 *   wrote the row — `"stub"` today, since no live payment provider is wired
 *   up.
 * - `organizationUsageCounters` — a generic per-organization, per-metric
 *   counter. The one metric wired up today (`"events"`) backs the one real
 *   limit this module enforces (`assertOrganizationCanCreateEventIn`,
 *   events-per-org); the table exists so a second metric is a new `metric`
 *   value, not a new table.
 */
export const billingPlans = pgTable("billing_plans", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  maxEvents: integer("max_events"),
  priceCents: integer("price_cents"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const organizationSubscriptions = pgTable("organization_subscriptions", {
  organizationId: uuid("organization_id").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
  planId: text("plan_id").notNull().references(() => billingPlans.id),
  status: subscriptionStatusEnum("status").notNull().default("active"),
  provider: text("provider").notNull().default("stub"),
  providerCustomerId: text("provider_customer_id"),
  providerSubscriptionId: text("provider_subscription_id"),
  currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const organizationUsageCounters = pgTable("organization_usage_counters", {
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  metric: text("metric").notNull(),
  count: integer("count").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [primaryKey({ columns: [table.organizationId, table.metric] })]);
