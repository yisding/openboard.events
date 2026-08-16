import { eq } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { events } from "@/db/schema";
import {
  getOrganizationIn,
  listOrganizationAuditLogIn,
  listOrganizationEventsIn,
  listOrganizationMembersIn,
  listPendingOrganizationEventInvitationsIn,
  listPendingOrganizationInvitationsIn,
  type OrganizationEventRow,
} from "@/features/organizations";
import {
  listOrganizationOnboardingMilestonesIn,
  type OrganizationOnboardingMilestone,
} from "@/features/product-signals";
import type {
  OrganizationAuditLogEntryDTO,
  OrganizationDTO,
  OrganizationEventInvitationDTO,
  OrganizationId,
  OrganizationInvitationDTO,
  OrganizationMemberDTO,
} from "@/shared/contracts";

/**
 * M47 — the organization half of "contact/org data export". Deliberately
 * scoped to the tenant's own administrative data — the organization row,
 * its members, pending invitations and audit trail, plus a summary list of
 * the events it owns — not a recursive dump of every one of those events'
 * submissions/sessions/comms. That is a separate, per-event surface
 * (`exportContactData` is its contact-scoped counterpart); folding it in
 * here would make this export unboundedly large for a multi-event
 * organization and would duplicate every other feature's own read path.
 *
 * Every read is an existing exported query (`features/organizations`), so
 * this module adds no new SQL of its own for the org bundle — only the
 * composition.
 */
/** First Fair (design §5.1) — `OrganizationEventRow` is `listOrganizationEventsIn`'s
 * own row type (distinct from `OrganizationEventAccessRow`, which the
 * organization-home listing widens with the caller's event role); `isDemo`
 * is stitched on here rather than in that shared query, which several other
 * non-demo callers also use. An export that silently dropped which of an
 * organization's events was the demo would be worse than one that labels it. */
export type OrganizationEventExportRow = OrganizationEventRow & { isDemo: boolean };

export type OrganizationDataExport = {
  exportedAt: string;
  organization: OrganizationDTO;
  members: OrganizationMemberDTO[];
  pendingInvitations: OrganizationInvitationDTO[];
  /**
   * Event-scoped reviewer invitations. They live in the same table under the
   * same organization with `event_id` set, and the workspace query filters
   * those out — so a bundle whose stated purpose is the complete administrative
   * record reported no pending invitations while five were outstanding, and
   * contradicted its own audit log's `reviewer.invited` entries.
   *
   * Each carries its `eventId`: the grant *is* event-scoped, so an entry
   * without one would name a role and an address while leaving the reader no
   * way to reconstruct what access was pending — a second, quieter version of
   * the same omission this field exists to close.
   */
  pendingEventInvitations: OrganizationEventInvitationDTO[];
  auditLog: OrganizationAuditLogEntryDTO[];
  onboardingMilestones: OrganizationOnboardingMilestone[];
  events: OrganizationEventExportRow[];
};

export async function exportOrganizationDataIn(dbOrTx: DbOrTx, organizationId: OrganizationId): Promise<OrganizationDataExport | null> {
  const organization = await getOrganizationIn(dbOrTx, organizationId);
  if (!organization) return null;
  const [members, pendingInvitations, pendingEventInvitations, auditLog, onboardingMilestones, eventRows, demoFlags] = await Promise.all([
    listOrganizationMembersIn(dbOrTx, organizationId),
    listPendingOrganizationInvitationsIn(dbOrTx, organizationId),
    listPendingOrganizationEventInvitationsIn(dbOrTx, organizationId),
    listOrganizationAuditLogIn(dbOrTx, organizationId, 1000),
    listOrganizationOnboardingMilestonesIn(dbOrTx, organizationId),
    listOrganizationEventsIn(dbOrTx, organizationId),
    dbOrTx.select({ id: events.id, isDemo: events.isDemo }).from(events).where(eq(events.organizationId, organizationId)),
  ]);
  const isDemoById = new Map(demoFlags.map((row) => [row.id, row.isDemo]));
  const exportedEvents = eventRows.map((row) => ({ ...row, isDemo: isDemoById.get(row.id) ?? false }));
  return { exportedAt: new Date().toISOString(), organization, members, pendingInvitations, pendingEventInvitations, auditLog, onboardingMilestones, events: exportedEvents };
}

export function exportOrganizationData(organizationId: OrganizationId): Promise<OrganizationDataExport | null> {
  return exportOrganizationDataIn(db, organizationId);
}
