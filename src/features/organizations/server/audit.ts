import { aliasedTable, desc, eq } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { organizationAuditLog, users } from "@/db/schema";
import { organizationAuditLogEntryDtoSchema, type OrganizationAuditLogEntryDTO, type OrganizationId, type UserId } from "@/shared/contracts";

/**
 * M44 — a light, append-only audit trail over organization membership
 * actions. One `INSERT` per event. Most callers accept the small gap between a
 * domain mutation and this evidence row; invitation enqueue passes a real
 * transaction because its token rotation, outbox row, and audit event form one
 * consistency boundary.
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
