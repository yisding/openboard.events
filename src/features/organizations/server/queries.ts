import { and, asc, eq, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { events, organizationMembers, organizations, users } from "@/db/schema";
import {
  eventIdSchema,
  organizationDtoSchema,
  organizationIdSchema,
  organizationMemberDtoSchema,
  userIdSchema,
  type EventId,
  type MemberRole,
  type OrganizationDTO,
  type OrganizationId,
  type OrganizationMemberDTO,
  type UserId,
} from "@/shared/contracts";

/**
 * M43 organization reads. Every function here is a single `neon-http`
 * statement — resolution #4 confines the WebSocket `withTx` pool to eight
 * named runtime functions and this feature is not one of them — so each
 * export takes a `DbOrTx` only so PGlite tests can inject a pglite-backed
 * handle; deployed callers pass `db`.
 *
 * Every read is organization-scoped in its WHERE clause, the same discipline
 * every event-scoped read follows for `event_id`: an organization id is the
 * first argument and never optional, so a query cannot accidentally span
 * tenants.
 */

function toOrganizationDto(row: typeof organizations.$inferSelect): OrganizationDTO {
  return organizationDtoSchema.parse({
    id: row.id,
    name: row.name,
    slug: row.slug,
    createdAt: row.createdAt.toISOString(),
  });
}

export async function getOrganizationIn(dbOrTx: DbOrTx, organizationId: OrganizationId): Promise<OrganizationDTO | null> {
  const [row] = await dbOrTx.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  return row ? toOrganizationDto(row) : null;
}
export const getOrganization = (organizationId: OrganizationId): Promise<OrganizationDTO | null> =>
  getOrganizationIn(db, organizationId);

export async function getOrganizationBySlugIn(dbOrTx: DbOrTx, slug: string): Promise<OrganizationDTO | null> {
  const [row] = await dbOrTx.select().from(organizations).where(eq(organizations.slug, slug)).limit(1);
  return row ? toOrganizationDto(row) : null;
}
export const getOrganizationBySlug = (slug: string): Promise<OrganizationDTO | null> => getOrganizationBySlugIn(db, slug);

/** An organization the user belongs to, with the role that membership carries. */
export type OrganizationMembership = { organization: OrganizationDTO; role: MemberRole };

export async function listOrganizationsForUserIn(dbOrTx: DbOrTx, userId: UserId): Promise<OrganizationMembership[]> {
  const rows = await dbOrTx.select({ organization: organizations, role: organizationMembers.role })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(eq(organizationMembers.userId, userId))
    .orderBy(asc(organizations.name));
  return rows.map((row) => ({ organization: toOrganizationDto(row.organization), role: row.role }));
}
export const listOrganizationsForUser = (userId: UserId): Promise<OrganizationMembership[]> =>
  listOrganizationsForUserIn(db, userId);

/**
 * The organization a user's work belongs to when nothing in the request names
 * one.
 *
 * Exists for exactly one caller: `POST /api/internal/events`, M11's legacy
 * event-creation hub. `eventsHubAuth` there has no organization segment and
 * never learned about tenancy, so before this every event it created took
 * `events.organization_id`'s column DEFAULT and landed in the shared default
 * organization — invisible to the creator's own organization surfaces, and
 * visible to every admin the 0010 backfill put in the default tenant.
 *
 * Deterministic and role-ordered: strongest role first (an owner's
 * organization is more likely the one they mean than one they merely review
 * for), then oldest membership, then id. Ordering by anything unstable would
 * let the same actor's two events land in two different tenants.
 *
 * `null` means the user belongs to no organization at all — possible only for
 * an account created outside both `provisionOrganizationForNewUserIn` and the
 * 0010 backfill (a hand-run `bootstrap-admin.ts`, say). The caller keeps the
 * pre-tenancy behavior in that case rather than refusing to create an event.
 */
export async function resolvePrimaryOrganizationIn(dbOrTx: DbOrTx, userId: UserId): Promise<OrganizationId | null> {
  const [row] = await dbOrTx.select({ organizationId: organizationMembers.organizationId })
    .from(organizationMembers)
    .where(eq(organizationMembers.userId, userId))
    .orderBy(
      sql`CASE ${organizationMembers.role} WHEN 'owner' THEN 0 WHEN 'organizer' THEN 1 ELSE 2 END`,
      asc(organizationMembers.createdAt),
      asc(organizationMembers.organizationId),
    )
    .limit(1);
  return row ? organizationIdSchema.parse(row.organizationId) : null;
}
export const resolvePrimaryOrganization = (userId: UserId): Promise<OrganizationId | null> =>
  resolvePrimaryOrganizationIn(db, userId);

export async function listOrganizationMembersIn(dbOrTx: DbOrTx, organizationId: OrganizationId): Promise<OrganizationMemberDTO[]> {
  const rows = await dbOrTx.select({
    userId: organizationMembers.userId,
    role: organizationMembers.role,
    createdAt: organizationMembers.createdAt,
    email: users.email,
    name: users.name,
  })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(eq(organizationMembers.organizationId, organizationId))
    .orderBy(asc(users.email));
  return rows.map((row) => organizationMemberDtoSchema.parse({
    userId: row.userId,
    organizationId,
    email: row.email,
    name: row.name,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
  }));
}
export const listOrganizationMembers = (organizationId: OrganizationId): Promise<OrganizationMemberDTO[]> =>
  listOrganizationMembersIn(db, organizationId);

export async function getOrganizationMemberRoleIn(dbOrTx: DbOrTx, organizationId: OrganizationId, userId: UserId): Promise<MemberRole | null> {
  const [row] = await dbOrTx.select({ role: organizationMembers.role })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, userId)))
    .limit(1);
  return row?.role ?? null;
}
export const getOrganizationMemberRole = (organizationId: OrganizationId, userId: UserId): Promise<MemberRole | null> =>
  getOrganizationMemberRoleIn(db, organizationId, userId);

/**
 * The organization-level event directory row. Deliberately not `EventDTO`:
 * the organization index lists events, it does not open them, and widening
 * `EventDTO` with an `organizationId` field would have forced every existing
 * producer of that frozen contract to change in lockstep.
 */
export type OrganizationEventRow = { id: EventId; name: string; slug: string; startsAt: string; endsAt: string };

export async function listOrganizationEventsIn(dbOrTx: DbOrTx, organizationId: OrganizationId): Promise<OrganizationEventRow[]> {
  const rows = await dbOrTx.select({
    id: events.id,
    name: events.name,
    slug: events.slug,
    startsAt: events.startsAt,
    endsAt: events.endsAt,
  })
    .from(events)
    .where(eq(events.organizationId, organizationId))
    .orderBy(asc(events.startsAt), asc(events.name));
  return rows.map((row) => ({
    id: eventIdSchema.parse(row.id),
    name: row.name,
    slug: row.slug,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
  }));
}
export const listOrganizationEvents = (organizationId: OrganizationId): Promise<OrganizationEventRow[]> =>
  listOrganizationEventsIn(db, organizationId);

/**
 * The event -> organization link, read on its own rather than folded into
 * `EventDTO`. `null` means the event does not exist; the column itself is NOT
 * NULL, so an existing event always has an organization.
 */
export async function getEventOrganizationIn(dbOrTx: DbOrTx, eventId: EventId): Promise<OrganizationId | null> {
  const [row] = await dbOrTx.select({ organizationId: events.organizationId })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  return row ? organizationIdSchema.parse(row.organizationId) : null;
}
export const getEventOrganization = (eventId: EventId): Promise<OrganizationId | null> => getEventOrganizationIn(db, eventId);

/**
 * Every user who can act on the organization, as branded ids. Used by M44's
 * member management and by the tests that assert the backfill populated the
 * default organization from `event_members`.
 */
export async function listOrganizationMemberIdsIn(dbOrTx: DbOrTx, organizationId: OrganizationId): Promise<UserId[]> {
  const rows = await dbOrTx.select({ userId: organizationMembers.userId })
    .from(organizationMembers)
    .where(eq(organizationMembers.organizationId, organizationId))
    .orderBy(asc(organizationMembers.userId));
  return rows.map((row) => userIdSchema.parse(row.userId));
}
