import { aliasedTable, and, desc, eq, inArray } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { events, organizationAuditLog, users } from "@/db/schema";
import { eventIdSchema, organizationAuditLogEntryDtoSchema, type EventId, type OrganizationAuditAction, type OrganizationAuditLogEntryDTO, type OrganizationId, type UserId } from "@/shared/contracts";

/**
 * M44 — a light, append-only audit trail over organization membership
 * actions. One `INSERT` per event. Team membership role/removal and invitation
 * enqueue pass real transactions because their domain mutation and this
 * evidence row form one consistency boundary. Other callers accept the small
 * gap between a domain mutation and this evidence row.
 *
 * `action` is the closed `OrganizationAuditAction` union rather than `string`
 * so that a writer in another feature cannot mint a vocabulary the reader has
 * no label for — the way every `demo.*` action once did.
 */
export async function recordOrganizationAuditEventIn(
  dbOrTx: DbOrTx,
  organizationId: OrganizationId,
  actorUserId: UserId | null,
  action: OrganizationAuditAction,
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

/**
 * The event an entry is about, read out of its own metadata.
 *
 * Six of the ten actions written today name one — `reviewer.invited`,
 * `reviewer.invitation_revoked`, `invitation.accepted` and all three
 * `demo.*` — under `eventId`, and `demo.scaffold_copied` names the event it
 * wrote to as `targetEventId`. Anything that is not a well-formed event id is
 * simply not an event reference; metadata is untyped `jsonb` and this reader
 * must never throw on a row somebody else wrote.
 */
function auditEventId(metadata: unknown): EventId | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const named = metadata as { eventId?: unknown; targetEventId?: unknown };
  const parsed = eventIdSchema.safeParse(named.eventId ?? named.targetEventId);
  return parsed.success ? parsed.data : null;
}

/**
 * Names for the events those ids point at, in one extra query rather than a
 * join through `jsonb`. An id with no row is not an error: `demo.deleted` is
 * *about* an event that no longer exists, and the entry has to outlive it.
 *
 * Tenant-scoped, because the id came out of untyped `jsonb`. Every writer puts
 * one of the organization's own events there, but a name is resolved for
 * display and the query should not be the one place that would happily read
 * another tenant's if a row ever said so.
 */
async function eventNamesFor(dbOrTx: DbOrTx, organizationId: OrganizationId, ids: readonly EventId[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await dbOrTx.select({ id: events.id, name: events.name })
    .from(events)
    .where(and(eq(events.organizationId, organizationId), inArray(events.id, [...new Set(ids)])));
  return new Map(rows.map((row) => [row.id, row.name]));
}

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
  const eventIds = rows.map((row) => auditEventId(row.metadata));
  const eventNames = await eventNamesFor(dbOrTx, organizationId, eventIds.filter((id): id is EventId => id !== null));
  return rows.map((row, index) => {
    const targetEventId = eventIds[index] ?? null;
    return organizationAuditLogEntryDtoSchema.parse({
      id: row.id,
      organizationId: row.organizationId,
      actorUserId: row.actorUserId,
      actorEmail: row.actorEmail,
      action: row.action,
      targetUserId: row.targetUserId,
      targetEmail: row.targetEmail,
      targetEventId,
      targetEventName: (targetEventId && eventNames.get(targetEventId)) ?? null,
      metadata: row.metadata,
      createdAt: row.createdAt.toISOString(),
    });
  });
}
export const listOrganizationAuditLog = (organizationId: OrganizationId, limit?: number) =>
  listOrganizationAuditLogIn(db, organizationId, limit);
