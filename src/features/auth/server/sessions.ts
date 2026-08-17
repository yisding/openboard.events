import { and, desc, eq, gt } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { adminSessions } from "@/db/schema";
import type { UserId } from "@/shared/contracts";
import { getCurrentAdminSessionId } from "./admin";

/**
 * M44 — admin session views over M42's revocable session store
 * (`admin_sessions`, written by Better Auth).
 * Self-service only: a signed-in identity sees and revokes their *own*
 * sessions. Deliberately not extended to "an owner revokes a teammate's
 * sessions" — `admin_sessions` is not organization-scoped (one person can
 * belong to several organizations), so removing someone from *one*
 * organization must not sign them out of every other one they legitimately
 * belong to. `revokeAdminSessions(userId)` (M42, `admin.ts`) already covers
 * "sign out everywhere"; this adds per-session listing and single-session
 * revocation on top of it.
 */
export type AdminSessionSummary = {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
  /** True for the sign-in reading the list — the one whose Revoke signs *you* out. */
  isCurrent: boolean;
};

export async function listAdminSessionsIn(dbOrTx: DbOrTx, userId: UserId, currentSessionId: string | null = null): Promise<AdminSessionSummary[]> {
  const rows = await dbOrTx.select({
    id: adminSessions.id,
    ipAddress: adminSessions.ipAddress,
    userAgent: adminSessions.userAgent,
    createdAt: adminSessions.createdAt,
    expiresAt: adminSessions.expiresAt,
  }).from(adminSessions).where(and(
    eq(adminSessions.userId, userId),
    // "Active sessions — every device currently signed in as you" has to mean
    // it. Retention keeps an `admin_sessions` row for 30 days *after* it
    // expires, so an expired sign-in sat under that heading for a month with a
    // past date in its Expires column and a live Revoke button, and inflated the
    // "Signed out of N sessions" count. The organization invitation list next
    // door fixed exactly this shape.
    gt(adminSessions.expiresAt, new Date()),
  )).orderBy(desc(adminSessions.createdAt));
  return rows.map((row) => ({
    id: row.id,
    // Better Auth writes this column itself and, when it can't determine the
    // client's address, writes `""` rather than `NULL` — so `?? "—"` at the
    // display layer never catches it. Normalize here, at the one place every
    // consumer of `AdminSessionSummary` reads through, so "unknown IP" is
    // `null` everywhere and no renderer has to know about the empty-string case.
    ipAddress: row.ipAddress === "" ? null : row.ipAddress,
    userAgent: row.userAgent,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    isCurrent: row.id === currentSessionId,
  }));
}
// The current session id is resolved here rather than at each call site so no
// caller can render a list where every row looks like someone else's.
export const listAdminSessions = async (userId: UserId): Promise<AdminSessionSummary[]> =>
  listAdminSessionsIn(db, userId, await getCurrentAdminSessionId());

/**
 * Scoped by `userId` so a caller can only ever revoke their own session id,
 * never someone else's by guessing it. Absence is deliberately a successful
 * no-op: a browser can safely replay the exact DELETE after losing the first
 * response, without learning whether another user's guessed session id exists.
 */
export async function revokeAdminSessionByIdIn(dbOrTx: DbOrTx, userId: UserId, sessionId: string): Promise<void> {
  await dbOrTx.delete(adminSessions).where(and(eq(adminSessions.id, sessionId), eq(adminSessions.userId, userId)));
}
export const revokeAdminSessionById = (userId: UserId, sessionId: string): Promise<void> => revokeAdminSessionByIdIn(db, userId, sessionId);
