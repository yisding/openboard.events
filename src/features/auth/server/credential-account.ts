import { and, eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { adminAccounts } from "@/db/schema";
import type { UserId } from "@/shared/contracts";

/** Create or rotate the Better Auth credential owned by an operator bootstrap. */
export async function upsertAdminCredentialAccount(
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
