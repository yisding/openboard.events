import { cookies, headers } from "next/headers";
import { and, eq, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { adminLoginAttempts, adminSessions, eventMembers, organizationMembers, users } from "@/db/schema";
import { userIdSchema, type EventId, type MemberRole, type OrganizationId, type UserId } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { getEnv } from "@/shared/lib/env";
import { sha256 } from "./crypto";
import { ADMIN_COOKIE, type AdminIdentity, verifyAdminToken, verifyPassword } from "./fallback-session";

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
const DUMMY_PASSWORD_HASH = "pbkdf2-sha256$100000$EREREREREREREREREREREQ$5bkm0H0nNzbXxMbKCOciwVgAQMmkB_XNFy2_7b_Tz74";

export function roleSatisfies(actual: MemberRole, required: MemberRole): boolean {
  return roleRank[actual] >= roleRank[required];
}

export function requiredRoleForEventPath(eventId: EventId, requestPath: string): MemberRole {
  const reviewBase = `/events/${eventId}/review`;
  const pathname = requestPath.split("?", 1)[0] ?? "";
  return pathname === reviewBase || pathname.startsWith(`${reviewBase}/`) ? "reviewer" : "organizer";
}

/**
 * M42 — the one place the auth provider is chosen.
 *
 * `requireAdmin(eventId, role?)` and `authorizeAdmin` below are untouched:
 * membership lookup, role ranking and the FORBIDDEN/UNAUTHORIZED split are the
 * same code on both providers, so the authorization decision cannot drift
 * between them (AC 2). All that changes is where the *identity* comes from —
 * a stateless jose JWT under `fallback`, a row in `admin_sessions` under
 * `better-auth`.
 */
async function betterAuthIdentity(): Promise<AdminIdentity | null> {
  // Imported lazily so the fallback path never pulls Better Auth into the
  // request, and so a `fallback` deployment does not pay for it at all.
  const { getAdminAuth } = await import("./better-auth");
  const session = await getAdminAuth().api.getSession({ headers: await headers() });
  if (!session?.user) return null;
  const userId = userIdSchema.safeParse(session.user.id);
  if (!userId.success) return null;
  return { userId: userId.data, email: session.user.email, name: session.user.name ?? "" };
}

export async function getAdminIdentity(): Promise<AdminIdentity | null> {
  const env = getEnv();
  if (env.ADMIN_AUTH_PROVIDER === "better-auth") return betterAuthIdentity();
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!token || !env.SESSION_SECRET) return null;
  return verifyAdminToken(token);
}

/**
 * M42 AC 4 — admin-driven revocation.
 *
 * Deleting the `admin_sessions` rows *is* the revocation: `getAdminIdentity`
 * re-reads the table on every request under the Better Auth provider, so the
 * next request from a revoked session finds nothing and gets UNAUTHORIZED. No
 * grace period, no waiting out a token's expiry.
 *
 * Returns the number of sessions ended. Under the `fallback` provider there is
 * nothing to revoke — its cookie is a self-contained signed JWT with no server
 * record — and this returns 0 rather than pretending otherwise. That gap is
 * precisely what M42 closes and why the switch exists.
 */
export async function revokeAdminSessions(userId: UserId, dbOrTx: DbOrTx = db): Promise<number> {
  const revoked = await dbOrTx.delete(adminSessions).where(eq(adminSessions.userId, userId)).returning();
  return revoked.length;
}

/**
 * Application-layer sign-in throttle: 5 attempts per email+IP per 15 minutes,
 * then a 15-minute block. Exported (M42) because it has to apply on *both*
 * providers — Better Auth's own rate limiter is a different policy on a
 * different store, and losing this control would be a silent security
 * regression hidden inside an auth-provider swap.
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

export async function authenticateAdmin(
  email: string,
  password: string,
  ipAddress = "unknown",
  dbOrTx: DbOrTx = db,
): Promise<AdminIdentity | null> {
  const normalized = email.trim().toLowerCase();
  const attemptKey = await registerLoginAttempt(dbOrTx, normalized, ipAddress);
  const [user] = await dbOrTx.select({ id: users.id, email: users.email, name: users.name, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, normalized))
    .limit(1);
  const validPassword = await verifyPassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!user?.passwordHash || !validPassword) return null;
  await dbOrTx.delete(adminLoginAttempts).where(eq(adminLoginAttempts.keyHash, attemptKey));
  return { userId: user.id as UserId, email: user.email, name: user.name };
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
 * drift: `getAdminIdentity` (one provider switch for both scopes),
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
