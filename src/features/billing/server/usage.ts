import { sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { organizationUsageCounters } from "@/db/schema";
import type { OrganizationId } from "@/shared/contracts";

/**
 * The generic metering primitive's one writer: an upsert that accumulates
 * rather than resets (see `organization_usage_counters`' migration comment —
 * no billing-period column yet). `assertOrganizationCanCreateEventIn` never
 * reads this counter — it counts `events` live, so this table is purely
 * additive display/metering data, never load-bearing for the entitlement
 * check itself. Incrementing it here alongside event creation is what proves
 * the write path end to end rather than leaving the table permanently empty.
 */
export async function incrementOrganizationUsageIn(dbOrTx: DbOrTx, organizationId: OrganizationId, metric: string, by = 1): Promise<void> {
  await dbOrTx.insert(organizationUsageCounters)
    .values({ organizationId, metric, count: by })
    .onConflictDoUpdate({
      target: [organizationUsageCounters.organizationId, organizationUsageCounters.metric],
      set: { count: sql`${organizationUsageCounters.count} + ${by}`, updatedAt: new Date() },
    });
}
export const incrementOrganizationUsage = (organizationId: OrganizationId, metric: string, by = 1): Promise<void> =>
  incrementOrganizationUsageIn(db, organizationId, metric, by);
