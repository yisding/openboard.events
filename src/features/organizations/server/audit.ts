import { aliasedTable, desc, eq } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { organizationAuditLog, users } from "@/db/schema";
import { organizationAuditLogEntryDtoSchema, type OrganizationAuditLogEntryDTO, type OrganizationId, type UserId } from "@/shared/contracts";

/**
 * M44 — a light, append-only audit trail over organization membership
 * actions. One `INSERT` per event, called after the mutation it records
 * (never wrapped together — resolution #4 confines `withTx` to eight audited
 * functions and this feature is not one of them, so a crash between "add the
 * member" and "log it" is possible and accepted, the same trade every
 * `enqueueEmail` caller in this codebase already makes for its own write).
 */
export async function recordOrganizationAuditEventIn(
  dbOrTx: DbOrTx,
  organizationId: OrganizationId,
  actorUserId: UserId | null,
  action: string,
  targetUserId: UserId | null,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await dbOrTx.insert(organizationAuditLog).values({
    organizationId,
    actorUserId,
    action,
    targetUserId,
    metadata,
  });
}

const actorUsers = aliasedTable(users, "audit_actor_users");
const targetUsers = aliasedTable(users, "audit_target_users");

export async function listOrganizationAuditLogIn(dbOrTx: DbOrTx, organizationId: OrganizationId, limit = 200): Promise<OrganizationAuditLogEntryDTO[]> {
  const rows = await dbOrTx.select({
    id: organizationAuditLog.id,
    organizationId: organizationAuditLog.organizationId,
    actorUserId: organizationAuditLog.actorUserId,
    actorEmail: actorUsers.email,
    action: organizationAuditLog.action,
    targetUserId: organizationAuditLog.targetUserId,
    targetEmail: targetUsers.email,
    metadata: organizationAuditLog.metadata,
    createdAt: organizationAuditLog.createdAt,
  }).from(organizationAuditLog)
    .leftJoin(actorUsers, eq(actorUsers.id, organizationAuditLog.actorUserId))
    .leftJoin(targetUsers, eq(targetUsers.id, organizationAuditLog.targetUserId))
    .where(eq(organizationAuditLog.organizationId, organizationId))
    .orderBy(desc(organizationAuditLog.createdAt))
    .limit(limit);
  return rows.map((row) => organizationAuditLogEntryDtoSchema.parse({
    id: row.id,
    organizationId: row.organizationId,
    actorUserId: row.actorUserId,
    actorEmail: row.actorEmail,
    action: row.action,
    targetUserId: row.targetUserId,
    targetEmail: row.targetEmail,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
  }));
}
export const listOrganizationAuditLog = (organizationId: OrganizationId, limit?: number) =>
  listOrganizationAuditLogIn(db, organizationId, limit);
