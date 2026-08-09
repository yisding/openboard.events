import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { eventMembers, users } from "@/db/schema";
import type { EventId, MemberRole, UserId } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { getEnv } from "@/shared/lib/env";
import { ADMIN_COOKIE, type AdminIdentity, verifyAdminToken, verifyPassword } from "./fallback-session";

export type AdminSession = {
  userId: UserId;
  email: string;
  name: string;
  role: MemberRole;
  eventId: EventId;
};

const roleRank: Record<MemberRole, number> = { reviewer: 1, organizer: 2, owner: 3 };

export function roleSatisfies(actual: MemberRole, required: MemberRole): boolean {
  return roleRank[actual] >= roleRank[required];
}

function testIdentity(): AdminIdentity | null {
  if (getEnv().TEST_AUTH !== "1") return null;
  return {
    userId: "00000000-0000-4000-8000-000000000001" as UserId,
    email: "organizer@openboard.test",
    name: "Test Organizer",
  };
}

export async function getAdminIdentity(): Promise<AdminIdentity | null> {
  const fixture = testIdentity();
  if (fixture) return fixture;
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!token || !getEnv().SESSION_SECRET) return null;
  return verifyAdminToken(token);
}

export async function authenticateAdmin(email: string, password: string): Promise<AdminIdentity | null> {
  const normalized = email.trim().toLowerCase();
  const [user] = await db.select({ id: users.id, email: users.email, name: users.name, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, normalized))
    .limit(1);
  if (!user?.passwordHash || !(await verifyPassword(password, user.passwordHash))) return null;
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
  if (getEnv().TEST_AUTH === "1") return { ...identity, eventId, role: "owner" };
  return authorizeAdmin(db, identity, eventId, role);
}

export async function getAdminSession(): Promise<AdminIdentity | null> {
  return getAdminIdentity();
}
