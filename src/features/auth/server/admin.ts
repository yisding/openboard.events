import { cookies } from "next/headers";
import { and, eq, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { adminLoginAttempts, eventMembers, users } from "@/db/schema";
import type { EventId, MemberRole, UserId } from "@/shared/contracts";
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

export async function getAdminIdentity(): Promise<AdminIdentity | null> {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!token || !getEnv().SESSION_SECRET) return null;
  return verifyAdminToken(token);
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
