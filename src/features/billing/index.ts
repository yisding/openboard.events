/**
 * Server barrel for the billing feature (M49 — billing scaffold).
 *
 * Plans/entitlements/metering hung off `organizations` (`@/features/organizations`).
 * `assertOrganizationCanCreateEvent{,In}` is the one real limit this scaffold
 * wires up (events-per-org), consumed by `@/features/onboarding`'s
 * `provisionOrganizationEventIn`. No live payment provider — see
 * `./server/provider.ts`'s header comment for the seam and its stub adapter.
 */
export { startBillingCheckoutInputSchema, type StartBillingCheckoutInput } from "./schemas";

export {
  countOrganizationEventsIn,
  getBillingPlan,
  getBillingPlanIn,
  getOrganizationBillingSummary,
  getOrganizationBillingSummaryIn,
  getOrganizationSubscription,
  getOrganizationSubscriptionIn,
  listBillingPlans,
  listBillingPlansIn,
  listOrganizationUsageCounters,
  listOrganizationUsageCountersIn,
} from "./server/queries";

export {
  assertOrganizationCanCreateEvent,
  assertOrganizationCanCreateEventIn,
  getOrganizationPlan,
  getOrganizationPlanIn,
} from "./server/entitlements";

export { incrementOrganizationUsage, incrementOrganizationUsageIn } from "./server/usage";

export {
  applyBillingProviderEvent,
  applyBillingProviderEventIn,
  getBillingProviderAdapter,
  StubBillingProviderAdapter,
  type BillingCheckoutInput,
  type BillingPortalInput,
  type BillingProviderAdapter,
  type BillingProviderWebhookEvent,
} from "./server/provider";
