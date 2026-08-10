import { and, eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { adminAccounts } from "@/db/schema";
import type { UserId } from "@/shared/contracts";

/**
 * M42 — keep `admin_accounts` in step with `users.password_hash`.
 *
 * `drizzle/0009_product_auth.sql` backfilled a credential account for every
 * account that existed when M42 landed, but provisioning did not stop:
 * `createEventReviewer` and `scripts/bootstrap-admin.ts` both mint accounts by
 * writing `users.password_hash` directly. Without this, an organizer created
 * after the migration but before the provider switch would have no credential
 * row and would simply be unable to sign in the moment the switch flipped —
 * the "orphaned account" M42 AC 1 rules out.
 *
 * So both writers call this, and both credentials stay valid: the fallback
 * reads `users.password_hash`, Better Auth reads `admin_accounts.password`, and
 * either provider can serve the same person. `accountId` is the user id, which
 * is what the backfill used, so a re-provision updates the row it already
 * created rather than colliding with it.
 *
 * This is only the *outbound* half. Passwords Better Auth writes itself — a
 * reset, a self-serve signup — never pass through here, so
 * `mirrorCredentialToFallback` (`better-auth.ts`) is the matching inbound copy.
 * "Either provider can serve the same person" is true only because both halves
 * exist; with just this one, a reset left the old password live on the
 * fallback and a Better Auth signup had no fallback credential at all.
 */
export async function upsertCredentialAccount(
  dbOrTx: DbOrTx,
  userId: UserId,
  passwordHash: string,
): Promise<void> {
  const now = new Date();
  const inserted = await dbOrTx.insert(adminAccounts)
    .values({ userId, accountId: userId, providerId: "credential", password: passwordHash, updatedAt: now })
    .onConflictDoNothing({ target: [adminAccounts.providerId, adminAccounts.accountId] })
    .returning();
  if (inserted.length > 0) return;
  await dbOrTx.update(adminAccounts)
    .set({ password: passwordHash, updatedAt: now })
    .where(and(eq(adminAccounts.providerId, "credential"), eq(adminAccounts.accountId, userId)));
}
