import { z } from "zod";
import { billingPlanIdSchema, subscriptionStatusSchema } from "./enums";
import { organizationIdSchema } from "./ids";

/**
 * M49 — billing scaffold contracts.
 *
 * Additive: nothing here changes an existing export. Mirrors `./organization.ts`'s
 * own framing — this is the schema spine `src/features/billing` hangs off,
 * consumed by the one real limit `assertOrganizationCanCreateEventIn` enforces
 * (events-per-org) and by the billing settings surface
 * (`/organizations/[organizationId]/billing`).
 */

const iso = z.iso.datetime();

export const billingPlanDtoSchema = z.object({
  id: billingPlanIdSchema,
  name: z.string(),
  /** `null` = unlimited. */
  maxEvents: z.int().positive().nullable(),
  /** `null` = custom/"contact us" pricing (today: `enterprise`). `0` is free. */
  priceCents: z.int().nonnegative().nullable(),
});
export type BillingPlanDTO = z.infer<typeof billingPlanDtoSchema>;

export const organizationSubscriptionDtoSchema = z.object({
  organizationId: organizationIdSchema,
  planId: billingPlanIdSchema,
  status: subscriptionStatusSchema,
  /** Which `BillingProviderAdapter` wrote this row — `"stub"` until a live provider is wired. */
  provider: z.string(),
  providerCustomerId: z.string().nullable(),
  providerSubscriptionId: z.string().nullable(),
  currentPeriodStart: iso.nullable(),
  currentPeriodEnd: iso.nullable(),
  cancelAtPeriodEnd: z.boolean(),
  createdAt: iso,
  updatedAt: iso,
});
export type OrganizationSubscriptionDTO = z.infer<typeof organizationSubscriptionDtoSchema>;

/** One `(organization_id, metric)` row from the generic metering primitive. */
export const organizationUsageCounterDtoSchema = z.object({
  organizationId: organizationIdSchema,
  metric: z.string(),
  count: z.int().nonnegative(),
  updatedAt: iso,
});
export type OrganizationUsageCounterDTO = z.infer<typeof organizationUsageCounterDtoSchema>;

/** One metered quantity against its plan limit — `limit: null` means unlimited. */
export const usageAgainstLimitSchema = z.object({
  used: z.int().nonnegative(),
  limit: z.int().positive().nullable(),
});
export type UsageAgainstLimit = z.infer<typeof usageAgainstLimitSchema>;

/**
 * The billing settings surface's one read: plan, subscription, and usage.
 * `events` is always present — it is the one real limit this module wires up
 * — `counters` carries whatever else `organization_usage_counters` has
 * accumulated for this organization (empty until a second metric is wired).
 */
export const organizationBillingSummaryDtoSchema = z.object({
  plan: billingPlanDtoSchema,
  subscription: organizationSubscriptionDtoSchema,
  usage: z.object({ events: usageAgainstLimitSchema }),
  counters: z.array(organizationUsageCounterDtoSchema),
});
export type OrganizationBillingSummaryDTO = z.infer<typeof organizationBillingSummaryDtoSchema>;
