import { db, type DbOrTx } from "@/db/client";
import type { BillingPlanDTO, OrganizationId } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { countOrganizationEventsIn, getBillingPlanIn, getOrganizationSubscriptionIn } from "./queries";

/**
 * M49 — the one entitlement check this scaffold wires to a real limit:
 * events-per-org.
 *
 * `createOrganizationIn`'s atomic CTE and the M49 backfill both guarantee
 * every organization has a subscription row, but `getOrganizationPlanIn`
 * still resolves defensively — a `NOT_FOUND`/missing row here means
 * "assume the most restrictive plan", not "let the check silently pass",
 * because a missing subscription must never widen what an organization is
 * entitled to.
 */
export async function getOrganizationPlanIn(dbOrTx: DbOrTx, organizationId: OrganizationId): Promise<BillingPlanDTO> {
  const subscription = await getOrganizationSubscriptionIn(dbOrTx, organizationId);
  const planId = subscription?.planId ?? "free";
  const plan = await getBillingPlanIn(dbOrTx, planId);
  if (!plan) throw new AppError("INTERNAL", `Unknown billing plan "${planId}"`);
  return plan;
}
export const getOrganizationPlan = (organizationId: OrganizationId): Promise<BillingPlanDTO> => getOrganizationPlanIn(db, organizationId);

/**
 * Called before `provisionOrganizationEventIn` creates a self-serve
 * organization's event — the only event-creation path this scaffold gates.
 * `POST /api/internal/events` (M11's original, non-organization-aware admin
 * path, still reachable and still landing rows under `DEFAULT_ORGANIZATION_ID`
 * unless reassigned) is deliberately left ungated: it predates tenancy
 * entirely and is not the self-serve billing surface this module scaffolds
 * — the same distinction `provisionOrganizationEventIn`'s own doc comment
 * already draws between the two paths.
 *
 * The count is a live `COUNT(events)`, not the `organization_usage_counters`
 * cache (`countOrganizationEventsIn`) — authoritative and immune to the
 * counter drifting out of sync, at the cost of one extra query per creation.
 * `maxEvents: null` is unlimited, so the check is a no-op for that plan.
 */
export async function assertOrganizationCanCreateEventIn(dbOrTx: DbOrTx, organizationId: OrganizationId): Promise<void> {
  const plan = await getOrganizationPlanIn(dbOrTx, organizationId);
  if (plan.maxEvents === null) return;
  const used = await countOrganizationEventsIn(dbOrTx, organizationId);
  if (used >= plan.maxEvents) {
    throw new AppError(
      "LIMIT_REACHED",
      `This organization is on the ${plan.name} plan, which is limited to ${plan.maxEvents} event${plan.maxEvents === 1 ? "" : "s"}. Upgrade to create another.`,
    );
  }
}
export const assertOrganizationCanCreateEvent = (organizationId: OrganizationId): Promise<void> => assertOrganizationCanCreateEventIn(db, organizationId);
