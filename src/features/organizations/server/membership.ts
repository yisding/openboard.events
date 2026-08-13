import { db, type DbOrTx } from "@/db/client";
import type { MemberRole, OrganizationId, UserId } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { recordOrganizationAuditEventIn } from "./audit";
import { getOrganizationMemberRoleIn } from "./queries";
import { removeOrganizationMemberIn, setOrganizationMemberIn } from "./mutations";

/**
 * M44 — role management over M43's membership. These wrap the plain
 * `setOrganizationMemberIn`/`removeOrganizationMemberIn` writes (unchanged,
 * still the audited last-owner guard) with the actor-side gate the roadmap's
 * "role management UI" needs and an audit log entry. M43 left ownership
 * transfer ungated at the feature layer on purpose (it only ever shipped
 * `createOrganizationIn`, where the owner is fixed at creation); this is
 * where that gate is added, one level up from the database's own last-owner
 * check.
 */

function requireOwnerForOwnershipChange(actorRole: MemberRole, involvesOwner: boolean): void {
  if (!involvesOwner) return;
  if (actorRole === "owner") return;
  throw new AppError("FORBIDDEN", "Only an owner can grant or revoke ownership");
}

export async function changeOrganizationMemberRoleIn(
  dbOrTx: DbOrTx,
  organizationId: OrganizationId,
  actorUserId: UserId,
  actorRole: MemberRole,
  targetUserId: UserId,
  role: MemberRole,
): Promise<MemberRole> {
  const currentRole = await getOrganizationMemberRoleIn(dbOrTx, organizationId, targetUserId);
  if (!currentRole) throw new AppError("NOT_FOUND", "That user is not a member of this organization");
  requireOwnerForOwnershipChange(actorRole, currentRole === "owner" || role === "owner");
  const updated = await setOrganizationMemberIn(dbOrTx, organizationId, targetUserId, role);
  await recordOrganizationAuditEventIn(dbOrTx, organizationId, actorUserId, "member.role_changed", targetUserId, { from: currentRole, to: updated });
  return updated;
}
export const changeOrganizationMemberRole = (organizationId: OrganizationId, actorUserId: UserId, actorRole: MemberRole, targetUserId: UserId, role: MemberRole) =>
  changeOrganizationMemberRoleIn(db, organizationId, actorUserId, actorRole, targetUserId, role);

export async function removeOrganizationMemberAuditedIn(
  dbOrTx: DbOrTx,
  organizationId: OrganizationId,
  actorUserId: UserId,
  actorRole: MemberRole,
  targetUserId: UserId,
): Promise<void> {
  const currentRole = await getOrganizationMemberRoleIn(dbOrTx, organizationId, targetUserId);
  if (!currentRole) throw new AppError("NOT_FOUND", "That user is not a member of this organization");
  requireOwnerForOwnershipChange(actorRole, currentRole === "owner");
  await removeOrganizationMemberIn(dbOrTx, organizationId, targetUserId);
  await recordOrganizationAuditEventIn(dbOrTx, organizationId, actorUserId, "member.removed", targetUserId, { role: currentRole });
}
export const removeOrganizationMemberAudited = (organizationId: OrganizationId, actorUserId: UserId, actorRole: MemberRole, targetUserId: UserId) =>
  removeOrganizationMemberAuditedIn(db, organizationId, actorUserId, actorRole, targetUserId);
