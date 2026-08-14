import { headers } from "next/headers";
import { and, eq, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { adminLoginAttempts, adminSessions, eventMembers, organizationMembers } from "@/db/schema";
import { userIdSchema, type EventId, type MemberRole, type OrganizationId, type UserId } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { sha256 } from "./crypto";

export type AdminIdentity = {
  userId: UserId;
  email: string;
  name: string;
};

export type AdminSession = {
  userId: UserId;
  email: string;
  name: string;
  role: MemberRole;
  eventId: EventId;
};

const roleRank: Record<MemberRole, number> = { reviewer: 1, organizer: 2, owner: 3 };
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;

export function roleSatisfies(actual: MemberRole, required: MemberRole): boolean {
  return roleRank[actual] >= roleRank[required];
}

export function requiredRoleForEventPath(eventId: EventId, requestPath: string): MemberRole {
  const reviewBase = `/events/${eventId}/review`;
  const pathname = requestPath.split("?", 1)[0] ?? "";
  return pathname === reviewBase || pathname.startsWith(`${reviewBase}/`) ? "reviewer" : "organizer";
}

/** Resolve the sole admin identity source: a revocable Better Auth session. */
export async function getAdminIdentity(): Promise<AdminIdentity | null> {
  const { getAdminAuth } = await import("./better-auth");
  const session = await getAdminAuth().api.getSession({ headers: await headers() });
  if (!session?.user) return null;
  const userId = userIdSchema.safeParse(session.user.id);
  if (!userId.success) return null;
  return { userId: userId.data, email: session.user.email, name: session.user.name ?? "" };
}

/**
 * M42 AC 4 — admin-driven revocation.
 *
 * Deleting the `admin_sessions` rows *is* the revocation: `getAdminIdentity`
 * re-reads the table on every request under the Better Auth provider, so the
 * next request from a revoked session finds nothing and gets UNAUTHORIZED. No
 * grace period, no waiting out a token's expiry.
 *
 * Returns the number of sessions ended.
 */
export async function revokeAdminSessions(userId: UserId, dbOrTx: DbOrTx = db): Promise<number> {
  const revoked = await dbOrTx.delete(adminSessions).where(eq(adminSessions.userId, userId)).returning();
  return revoked.length;
}

/**
 * Application-layer sign-in throttle: 5 attempts per email+IP per 15 minutes,
 * then a 15-minute block. Better Auth's own rate limiter is a different policy
 * on a different store, so this application-level control remains authoritative.
 */
export async function throttleAdminLogin(email: string, ipAddress: string, dbOrTx: DbOrTx = db): Promise<string> {
  return registerLoginAttempt(dbOrTx, email.trim().toLowerCase(), ipAddress);
}

export async function clearAdminLoginThrottle(attemptKey: string, dbOrTx: DbOrTx = db): Promise<void> {
  await dbOrTx.delete(adminLoginAttempts).where(eq(adminLoginAttempts.keyHash, attemptKey));
}

async function registerLoginAttempt(dbOrTx: DbOrTx, normalizedEmail: string, ipAddress: string): Promise<string> {
  const keyHash = await sha256(`${normalizedEmail}\0${ipAddress}`);
  const now = new Date();
  const windowCutoff = new Date(now.getTime() - LOGIN_WINDOW_MS);
  const blockUntil = new Date(now.getTime() + LOGIN_WINDOW_MS);
  const [attempt] = await dbOrTx.insert(adminLoginAttempts)
    .values({ keyHash, attempts: 1, windowStartedAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: adminLoginAttempts.keyHash,
      set: {
        attempts: sql<number>`CASE WHEN ${adminLoginAttempts.windowStartedAt} > ${windowCutoff} THEN ${adminLoginAttempts.attempts} + 1 ELSE 1 END`,
        windowStartedAt: sql<Date>`CASE WHEN ${adminLoginAttempts.windowStartedAt} > ${windowCutoff} THEN ${adminLoginAttempts.windowStartedAt} ELSE ${now} END`,
        blockedUntil: sql<Date | null>`CASE
          WHEN ${adminLoginAttempts.blockedUntil} > ${now} THEN ${adminLoginAttempts.blockedUntil}
          WHEN ${adminLoginAttempts.windowStartedAt} > ${windowCutoff} AND ${adminLoginAttempts.attempts} >= ${MAX_LOGIN_ATTEMPTS} THEN ${blockUntil}
          ELSE NULL
        END`,
        updatedAt: now,
      },
    })
    .returning();
  if (attempt?.blockedUntil && attempt.blockedUntil > now) {
    throw new AppError("RATE_LIMITED", "Too many sign-in attempts. Try again later.");
  }
  return keyHash;
}

export async function authorizeAdmin(
  dbOrTx: DbOrTx,
  identity: AdminIdentity,
  eventId: EventId,
  requiredRole?: MemberRole,
): Promise<AdminSession> {
  const [membership] = await dbOrTx.select({ role: eventMembers.role })
    .from(eventMembers)
    .where(and(eq(eventMembers.userId, identity.userId), eq(eventMembers.eventId, eventId)))
    .limit(1);
  if (!membership || (requiredRole && !roleSatisfies(membership.role, requiredRole))) {
    throw new AppError("FORBIDDEN", "You do not have access to this event");
  }
  return { ...identity, role: membership.role, eventId };
}

export async function requireAdmin(eventId: EventId, role?: MemberRole): Promise<AdminSession> {
  const identity = await getAdminIdentity();
  if (!identity) throw new AppError("UNAUTHORIZED", "Sign in required");
  return authorizeAdmin(db, identity, eventId, role);
}

export async function getAdminSession(): Promise<AdminIdentity | null> {
  return getAdminIdentity();
}

/**
 * M43 — the organization-scoped half of the guard pair.
 *
 * This is a *composition*, not a replacement. `requireAdmin(eventId, role?)`
 * and `authorizeAdmin` above are byte-for-byte unchanged: they read
 * `event_members` and nothing else, so no organization membership can widen
 * anyone's access to an event, and the per-event contract every route and
 * every test already depends on is exactly what it was before M43.
 *
 * The three pieces that are shared, deliberately, are the ones that must not
 * drift: `getAdminIdentity` (one identity source for both scopes),
 * `roleSatisfies` (one `owner > organizer > reviewer` ladder, because
 * `organization_members.role` is the same `member_role` enum), and the
 * UNAUTHORIZED/FORBIDDEN split (no identity is 401; an identity without
 * sufficient membership is 403). Everything else — which table is read, which
 * id scopes it — is different by construction.
 */
export type OrganizationSession = {
  userId: UserId;
  email: string;
  name: string;
  role: MemberRole;
  organizationId: OrganizationId;
};

export async function authorizeOrganization(
  dbOrTx: DbOrTx,
  identity: AdminIdentity,
  organizationId: OrganizationId,
  requiredRole?: MemberRole,
): Promise<OrganizationSession> {
  const [membership] = await dbOrTx.select({ role: organizationMembers.role })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.userId, identity.userId), eq(organizationMembers.organizationId, organizationId)))
    .limit(1);
  if (!membership || (requiredRole && !roleSatisfies(membership.role, requiredRole))) {
    throw new AppError("FORBIDDEN", "You do not have access to this organization");
  }
  return { ...identity, role: membership.role, organizationId };
}

export async function requireOrganizationAdmin(organizationId: OrganizationId, role?: MemberRole): Promise<OrganizationSession> {
  const identity = await getAdminIdentity();
  if (!identity) throw new AppError("UNAUTHORIZED", "Sign in required");
  return authorizeOrganization(db, identity, organizationId, role);
}
