import { aliasedTable, and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { rowsOf } from "@/db/query-result";
import { eventMembers, events, organizationMembers, users } from "@/db/schema";
import {
  eventAccessMemberDtoSchema,
  eventAccessOverviewDtoSchema,
  manageableEventAccessDtoSchema,
  memberRoleSchema,
  organizationIdSchema,
  type EventId,
  type EventAccessMemberDTO,
  type EventAccessOverviewDTO,
  type ManageableEventAccessDTO,
  type MemberRole,
  type OrganizationId,
  type UserId,
} from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";

export type AssignableEventRole = Exclude<MemberRole, "owner">;

const actorEventMemberships = aliasedTable(eventMembers, "event_access_actor_memberships");
const targetEventMemberships = aliasedTable(eventMembers, "event_access_target_memberships");
const actorOrganizationMemberships = aliasedTable(organizationMembers, "event_access_actor_organization_memberships");
const targetOrganizationMemberships = aliasedTable(organizationMembers, "event_access_target_organization_memberships");

/**
 * Only events on which the actor is already organizer+ are returned. Being an
 * organization organizer alone never makes an event visible or manageable.
 */
export async function listManageableEventAccessForMemberIn(
  dbOrTx: DbOrTx,
  organizationId: OrganizationId,
  actorUserId: UserId,
  targetUserId: UserId,
): Promise<ManageableEventAccessDTO[]> {
  const rows = await dbOrTx.select({
    eventId: events.id,
    eventName: events.name,
    role: targetEventMemberships.role,
  })
    .from(events)
    .innerJoin(actorOrganizationMemberships, and(
      eq(actorOrganizationMemberships.organizationId, organizationId),
      eq(actorOrganizationMemberships.userId, actorUserId),
      inArray(actorOrganizationMemberships.role, ["owner", "organizer"]),
    ))
    .innerJoin(targetOrganizationMemberships, and(
      eq(targetOrganizationMemberships.organizationId, organizationId),
      eq(targetOrganizationMemberships.userId, targetUserId),
    ))
    .innerJoin(actorEventMemberships, and(
      eq(actorEventMemberships.eventId, events.id),
      eq(actorEventMemberships.userId, actorUserId),
      inArray(actorEventMemberships.role, ["owner", "organizer"]),
    ))
    .leftJoin(targetEventMemberships, and(
      eq(targetEventMemberships.eventId, events.id),
      eq(targetEventMemberships.userId, targetUserId),
    ))
    .where(eq(events.organizationId, organizationId))
    .orderBy(asc(events.startsAt), asc(events.name));
  return rows.map((row) => manageableEventAccessDtoSchema.parse(row));
}
export const listManageableEventAccessForMember = (
  organizationId: OrganizationId,
  actorUserId: UserId,
  targetUserId: UserId,
): Promise<ManageableEventAccessDTO[]> => listManageableEventAccessForMemberIn(db, organizationId, actorUserId, targetUserId);

/**
 * One guarded upsert enforces all four axes at write time: same organization,
 * target organization membership, actor organization organizer+, and actor
 * event organizer+. Existing owner/organizer roles are never demoted by a
 * weaker requested role.
 */
export async function setExplicitEventAccessIn(
  dbOrTx: DbOrTx,
  organizationId: OrganizationId,
  eventId: EventId,
  actorUserId: UserId,
  targetUserId: UserId,
  role: AssignableEventRole,
): Promise<MemberRole> {
  if (actorUserId === targetUserId) throw new AppError("VALIDATION", "You already have access to this event");
  const requestedRole = memberRoleSchema.exclude(["owner"]).parse(role);
  const result = await dbOrTx.execute(sql`
    WITH authorized_event AS (
      SELECT event.id
      FROM events event
      JOIN organization_members actor_org
        ON actor_org.organization_id = event.organization_id
       AND actor_org.user_id = ${actorUserId}::uuid
       AND actor_org.role IN ('owner', 'organizer')
      JOIN organization_members target_org
        ON target_org.organization_id = event.organization_id
       AND target_org.user_id = ${targetUserId}::uuid
      JOIN event_members actor_event
        ON actor_event.event_id = event.id
       AND actor_event.user_id = ${actorUserId}::uuid
       AND actor_event.role IN ('owner', 'organizer')
      WHERE event.id = ${eventId}::uuid
        AND event.organization_id = ${organizationId}::uuid
    )
    INSERT INTO event_members (user_id, event_id, role)
    SELECT ${targetUserId}::uuid, authorized_event.id, ${requestedRole}::member_role
    FROM authorized_event
    ON CONFLICT (user_id, event_id) DO UPDATE SET role = CASE
      WHEN event_members.role IN ('owner', 'organizer') THEN event_members.role
      ELSE EXCLUDED.role
    END
    RETURNING role
  `);
  const [row] = rowsOf<{ role: MemberRole }>(result);
  if (!row) throw new AppError("FORBIDDEN", "You can grant access only to organization teammates on events you organize");
  return memberRoleSchema.parse(row.role);
}
export const setExplicitEventAccess = (
  organizationId: OrganizationId,
  eventId: EventId,
  actorUserId: UserId,
  targetUserId: UserId,
  role: AssignableEventRole,
): Promise<MemberRole> => setExplicitEventAccessIn(db, organizationId, eventId, actorUserId, targetUserId, role);

export async function removeExplicitEventAccessIn(
  dbOrTx: DbOrTx,
  organizationId: OrganizationId,
  eventId: EventId,
  actorUserId: UserId,
  targetUserId: UserId,
): Promise<void> {
  if (actorUserId === targetUserId) throw new AppError("VALIDATION", "Ask another event organizer to remove your own access");
  const result = await dbOrTx.execute(sql`
    WITH authorized_event AS (
      SELECT event.id
      FROM events event
      JOIN organization_members actor_org
        ON actor_org.organization_id = event.organization_id
       AND actor_org.user_id = ${actorUserId}::uuid
       AND actor_org.role IN ('owner', 'organizer')
      JOIN organization_members target_org
        ON target_org.organization_id = event.organization_id
       AND target_org.user_id = ${targetUserId}::uuid
      JOIN event_members actor_event
        ON actor_event.event_id = event.id
       AND actor_event.user_id = ${actorUserId}::uuid
       AND actor_event.role IN ('owner', 'organizer')
      WHERE event.id = ${eventId}::uuid
        AND event.organization_id = ${organizationId}::uuid
    ), existing AS (
      SELECT membership.role
      FROM event_members membership
      JOIN authorized_event ON authorized_event.id = membership.event_id
      WHERE membership.user_id = ${targetUserId}::uuid
    ), removed AS (
      DELETE FROM event_members membership
      USING authorized_event
      WHERE membership.event_id = authorized_event.id
        AND membership.user_id = ${targetUserId}::uuid
        AND membership.role <> 'owner'
      RETURNING membership.role
    )
    SELECT
      EXISTS (SELECT 1 FROM authorized_event) AS authorized,
      (SELECT role FROM existing) AS existing_role,
      (SELECT role FROM removed) AS removed_role
  `);
  const [row] = rowsOf<{ authorized: boolean; existing_role: MemberRole | null; removed_role: MemberRole | null }>(result);
  if (!row?.authorized) throw new AppError("FORBIDDEN", "You can remove access only from organization teammates on events you organize");
  if (row.existing_role === "owner") throw new AppError("VALIDATION", "Event owner access cannot be removed here");
  if (!row.removed_role) throw new AppError("NOT_FOUND", "That teammate has no access to this event");
}
export const removeExplicitEventAccess = (
  organizationId: OrganizationId,
  eventId: EventId,
  actorUserId: UserId,
  targetUserId: UserId,
): Promise<void> => removeExplicitEventAccessIn(db, organizationId, eventId, actorUserId, targetUserId);

/**
 * Event settings is the recovery surface for access that outlives organization
 * membership, so this list deliberately includes every event_members row.
 */
export async function listEventAccessMembersIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  actorUserId: UserId,
): Promise<EventAccessMemberDTO[]> {
  const rows = await dbOrTx.select({
    userId: eventMembers.userId,
    email: users.email,
    name: users.name,
    role: eventMembers.role,
    organizationMemberUserId: organizationMembers.userId,
  })
    .from(eventMembers)
    .innerJoin(users, eq(users.id, eventMembers.userId))
    .innerJoin(events, eq(events.id, eventMembers.eventId))
    .leftJoin(organizationMembers, and(
      eq(organizationMembers.organizationId, events.organizationId),
      eq(organizationMembers.userId, eventMembers.userId),
    ))
    .where(eq(eventMembers.eventId, eventId))
    .orderBy(
      sql`CASE ${eventMembers.role} WHEN 'owner' THEN 0 WHEN 'organizer' THEN 1 ELSE 2 END`,
      asc(users.email),
    );
  return rows.map((row) => eventAccessMemberDtoSchema.parse({
    userId: row.userId,
    email: row.email,
    name: row.name,
    role: row.role,
    organizationMember: row.organizationMemberUserId !== null,
    canRemove: row.role !== "owner" && row.userId !== actorUserId,
  }));
}
export const listEventAccessMembers = (eventId: EventId, actorUserId: UserId): Promise<EventAccessMemberDTO[]> =>
  listEventAccessMembersIn(db, eventId, actorUserId);

/**
 * Lists the roster and grant picker from the event itself. Teammate identities
 * are disclosed only when the actor has both organization and event authority;
 * an event-only organizer instead gets a truthful, actionable explanation.
 */
export async function getEventAccessOverviewIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  actorUserId: UserId,
): Promise<EventAccessOverviewDTO> {
  const [scope] = await dbOrTx.select({
    organizationId: events.organizationId,
    eventRole: actorEventMemberships.role,
    organizationRole: actorOrganizationMemberships.role,
  })
    .from(events)
    .leftJoin(actorEventMemberships, and(
      eq(actorEventMemberships.eventId, events.id),
      eq(actorEventMemberships.userId, actorUserId),
    ))
    .leftJoin(actorOrganizationMemberships, and(
      eq(actorOrganizationMemberships.organizationId, events.organizationId),
      eq(actorOrganizationMemberships.userId, actorUserId),
    ))
    .where(eq(events.id, eventId));

  if (!scope || !scope.eventRole || !["owner", "organizer"].includes(scope.eventRole)) {
    throw new AppError("FORBIDDEN", "Only an event organizer can manage event access");
  }

  const members = await listEventAccessMembersIn(dbOrTx, eventId, actorUserId);
  const canGrant = scope.organizationRole === "owner" || scope.organizationRole === "organizer";
  if (!canGrant) {
    return eventAccessOverviewDtoSchema.parse({
      members,
      candidates: [],
      canGrant: false,
      grantRestriction: "Granting requires organizer access to both this event and its organization. Ask an organization owner or organizer who also organizes this event.",
    });
  }

  const candidates = await dbOrTx.select({
    userId: organizationMembers.userId,
    email: users.email,
    name: users.name,
    organizationRole: organizationMembers.role,
  })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .leftJoin(targetEventMemberships, and(
      eq(targetEventMemberships.eventId, eventId),
      eq(targetEventMemberships.userId, organizationMembers.userId),
    ))
    .where(and(
      eq(organizationMembers.organizationId, scope.organizationId),
      ne(organizationMembers.userId, actorUserId),
      isNull(targetEventMemberships.userId),
    ))
    .orderBy(asc(users.name), asc(users.email));

  return eventAccessOverviewDtoSchema.parse({
    members,
    candidates,
    canGrant: true,
    grantRestriction: null,
  });
}
export const getEventAccessOverview = (eventId: EventId, actorUserId: UserId): Promise<EventAccessOverviewDTO> =>
  getEventAccessOverviewIn(db, eventId, actorUserId);

/** Event-scoped grant used by Settings; organization scope is derived, never trusted from the client. */
export async function setEventAccessMemberIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  actorUserId: UserId,
  targetUserId: UserId,
  role: AssignableEventRole,
): Promise<EventAccessMemberDTO> {
  if (actorUserId === targetUserId) throw new AppError("VALIDATION", "You already have access to this event");
  const [event] = await dbOrTx.select({ organizationId: events.organizationId })
    .from(events)
    .where(eq(events.id, eventId));
  if (!event) throw new AppError("NOT_FOUND", "Event not found");

  await setExplicitEventAccessIn(
    dbOrTx,
    organizationIdSchema.parse(event.organizationId),
    eventId,
    actorUserId,
    targetUserId,
    role,
  );
  const member = (await listEventAccessMembersIn(dbOrTx, eventId, actorUserId))
    .find((candidate) => candidate.userId === targetUserId);
  if (!member) throw new AppError("INTERNAL", "Event access was granted but could not be reloaded");
  return member;
}
export const setEventAccessMember = (
  eventId: EventId,
  actorUserId: UserId,
  targetUserId: UserId,
  role: AssignableEventRole,
): Promise<EventAccessMemberDTO> => setEventAccessMemberIn(db, eventId, actorUserId, targetUserId, role);

/** Event authority is sufficient to revoke access; the target may have left the organization. */
export async function removeEventAccessMemberIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  actorUserId: UserId,
  targetUserId: UserId,
): Promise<void> {
  if (actorUserId === targetUserId) throw new AppError("VALIDATION", "Ask another event organizer to remove your own access");
  const result = await dbOrTx.execute(sql`
    WITH authorized_event AS (
      SELECT membership.event_id
      FROM event_members membership
      WHERE membership.event_id = ${eventId}::uuid
        AND membership.user_id = ${actorUserId}::uuid
        AND membership.role IN ('owner', 'organizer')
    ), existing AS MATERIALIZED (
      SELECT membership.role
      FROM event_members membership
      JOIN authorized_event ON authorized_event.event_id = membership.event_id
      WHERE membership.user_id = ${targetUserId}::uuid
      FOR UPDATE OF membership
    ), removed AS (
      DELETE FROM event_members membership
      USING authorized_event, existing
      WHERE membership.event_id = authorized_event.event_id
        AND membership.user_id = ${targetUserId}::uuid
        AND existing.role <> 'owner'
      RETURNING membership.role
    )
    SELECT
      EXISTS (SELECT 1 FROM authorized_event) AS authorized,
      (SELECT role FROM existing) AS existing_role,
      (SELECT role FROM removed) AS removed_role
  `);
  const [row] = rowsOf<{ authorized: boolean; existing_role: MemberRole | null; removed_role: MemberRole | null }>(result);
  if (!row?.authorized) throw new AppError("FORBIDDEN", "Only an event organizer can remove event access");
  if (row.existing_role === "owner") throw new AppError("VALIDATION", "Event owner access cannot be removed here");
  if (row.existing_role !== null && !row.removed_role) {
    throw new AppError("CONFLICT", "Event access changed while it was being removed. Reload current access before trying again.");
  }
  // A lost response must be safe to replay. Once actor authority and the
  // owner guard have been checked above, an absent target is already in the
  // requested state and is therefore the canonical successful outcome.
}
export const removeEventAccessMember = (eventId: EventId, actorUserId: UserId, targetUserId: UserId): Promise<void> =>
  removeEventAccessMemberIn(db, eventId, actorUserId, targetUserId);
