import { db, type DbOrTx } from "@/db/client";
import {
  getOrganizationIn,
  listOrganizationAuditLogIn,
  listOrganizationEventsIn,
  listOrganizationMembersIn,
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
export type OrganizationDataExport = {
  exportedAt: string;
  organization: OrganizationDTO;
  members: OrganizationMemberDTO[];
  pendingInvitations: OrganizationInvitationDTO[];
  auditLog: OrganizationAuditLogEntryDTO[];
  onboardingMilestones: OrganizationOnboardingMilestone[];
  events: OrganizationEventRow[];
};

export async function exportOrganizationDataIn(dbOrTx: DbOrTx, organizationId: OrganizationId): Promise<OrganizationDataExport | null> {
  const organization = await getOrganizationIn(dbOrTx, organizationId);
  if (!organization) return null;
  const [members, pendingInvitations, auditLog, onboardingMilestones, events] = await Promise.all([
    listOrganizationMembersIn(dbOrTx, organizationId),
    listPendingOrganizationInvitationsIn(dbOrTx, organizationId),
    listOrganizationAuditLogIn(dbOrTx, organizationId, 1000),
    listOrganizationOnboardingMilestonesIn(dbOrTx, organizationId),
    listOrganizationEventsIn(dbOrTx, organizationId),
  ]);
  return { exportedAt: new Date().toISOString(), organization, members, pendingInvitations, auditLog, onboardingMilestones, events };
}

export function exportOrganizationData(organizationId: OrganizationId): Promise<OrganizationDataExport | null> {
  return exportOrganizationDataIn(db, organizationId);
}
