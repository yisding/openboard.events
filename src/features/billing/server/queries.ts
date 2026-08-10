import { asc, count, eq } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { billingPlans, events, organizationSubscriptions, organizationUsageCounters } from "@/db/schema";
import {
  billingPlanDtoSchema,
  organizationBillingSummaryDtoSchema,
  organizationSubscriptionDtoSchema,
  organizationUsageCounterDtoSchema,
  type BillingPlanDTO,
  type OrganizationBillingSummaryDTO,
  type OrganizationId,
  type OrganizationSubscriptionDTO,
  type OrganizationUsageCounterDTO,
} from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";

/**
 * M49 billing reads. Every function here is a single `neon-http` statement —
 * resolution #4 confines the WebSocket `withTx` pool to named runtime
 * functions and this feature is not one of them — so each export takes a
 * `DbOrTx` only so PGlite tests can inject a pglite-backed handle; deployed
 * callers pass `db`. Every read is organization-scoped in its WHERE clause,
 * the same discipline `features/organizations/server/queries.ts` documents
 * for its own reads.
 */

function toBillingPlanDto(row: typeof billingPlans.$inferSelect): BillingPlanDTO {
  return billingPlanDtoSchema.parse({ id: row.id, name: row.name, maxEvents: row.maxEvents, priceCents: row.priceCents });
}

function toSubscriptionDto(row: typeof organizationSubscriptions.$inferSelect): OrganizationSubscriptionDTO {
  return organizationSubscriptionDtoSchema.parse({
    organizationId: row.organizationId,
    planId: row.planId,
    status: row.status,
    provider: row.provider,
    providerCustomerId: row.providerCustomerId,
    providerSubscriptionId: row.providerSubscriptionId,
    currentPeriodStart: row.currentPeriodStart?.toISOString() ?? null,
    currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

export async function getBillingPlanIn(dbOrTx: DbOrTx, planId: string): Promise<BillingPlanDTO | null> {
  const [row] = await dbOrTx.select().from(billingPlans).where(eq(billingPlans.id, planId)).limit(1);
  return row ? toBillingPlanDto(row) : null;
}
export const getBillingPlan = (planId: string): Promise<BillingPlanDTO | null> => getBillingPlanIn(db, planId);

export async function listBillingPlansIn(dbOrTx: DbOrTx): Promise<BillingPlanDTO[]> {
  const rows = await dbOrTx.select().from(billingPlans).orderBy(asc(billingPlans.createdAt));
  return rows.map(toBillingPlanDto);
}
export const listBillingPlans = (): Promise<BillingPlanDTO[]> => listBillingPlansIn(db);

export async function getOrganizationSubscriptionIn(dbOrTx: DbOrTx, organizationId: OrganizationId): Promise<OrganizationSubscriptionDTO | null> {
  const [row] = await dbOrTx.select().from(organizationSubscriptions).where(eq(organizationSubscriptions.organizationId, organizationId)).limit(1);
  return row ? toSubscriptionDto(row) : null;
}
export const getOrganizationSubscription = (organizationId: OrganizationId): Promise<OrganizationSubscriptionDTO | null> =>
  getOrganizationSubscriptionIn(db, organizationId);

export async function listOrganizationUsageCountersIn(dbOrTx: DbOrTx, organizationId: OrganizationId): Promise<OrganizationUsageCounterDTO[]> {
  const rows = await dbOrTx.select().from(organizationUsageCounters).where(eq(organizationUsageCounters.organizationId, organizationId)).orderBy(asc(organizationUsageCounters.metric));
  return rows.map((row) => organizationUsageCounterDtoSchema.parse({
    organizationId,
    metric: row.metric,
    count: row.count,
    updatedAt: row.updatedAt.toISOString(),
  }));
}
export const listOrganizationUsageCounters = (organizationId: OrganizationId): Promise<OrganizationUsageCounterDTO[]> =>
  listOrganizationUsageCountersIn(db, organizationId);

/** Live count, not the `organization_usage_counters` cache — the authoritative source for "how many events does this organization have right now". */
export async function countOrganizationEventsIn(dbOrTx: DbOrTx, organizationId: OrganizationId): Promise<number> {
  const [row] = await dbOrTx.select({ n: count() }).from(events).where(eq(events.organizationId, organizationId));
  return row?.n ?? 0;
}

/**
 * The billing settings surface's one read. `subscription` is expected to
 * always exist (`createOrganizationIn`'s atomic CTE and the M49 backfill both
 * guarantee it) — a missing row is `INTERNAL`, not a silently-assumed-free
 * default, because a live billing relationship must never be guessed at.
 */
export async function getOrganizationBillingSummaryIn(dbOrTx: DbOrTx, organizationId: OrganizationId): Promise<OrganizationBillingSummaryDTO> {
  const subscription = await getOrganizationSubscriptionIn(dbOrTx, organizationId);
  if (!subscription) throw new AppError("INTERNAL", "This organization has no billing subscription row");
  const plan = await getBillingPlanIn(dbOrTx, subscription.planId);
  if (!plan) throw new AppError("INTERNAL", `Unknown billing plan "${subscription.planId}"`);
  const [used, counters] = await Promise.all([
    countOrganizationEventsIn(dbOrTx, organizationId),
    listOrganizationUsageCountersIn(dbOrTx, organizationId),
  ]);
  return organizationBillingSummaryDtoSchema.parse({
    plan,
    subscription,
    usage: { events: { used, limit: plan.maxEvents } },
    counters,
  });
}
export const getOrganizationBillingSummary = (organizationId: OrganizationId): Promise<OrganizationBillingSummaryDTO> =>
  getOrganizationBillingSummaryIn(db, organizationId);
