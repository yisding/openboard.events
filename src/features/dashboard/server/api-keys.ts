import { and, desc, eq } from "drizzle-orm";
import { randomBytes, sha256, toBase64Url } from "@/features/auth/server/crypto";
import { db, type DbOrTx } from "@/db/client";
import { apiKeys } from "@/db/schema";
import { apiKeyIdSchema, type ApiKeyId, type EventId } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";

/**
 * API key lifecycle — create/list/revoke only. Verification lives in
 * `features/auth`'s `apiKeyAuth()` (M06a): one implementation of hashed-bearer
 * auth in the repo, this module owns issuing and retiring rows, never
 * checking them.
 *
 * The frozen `api_keys` schema (`drizzle/0000_init.sql`) stores `name` and
 * `key_hash` only — no `last_four` column. A key's last four characters are
 * therefore never persisted or shown after creation; the label is what an
 * organizer tells two keys apart later, and the plaintext is shown exactly
 * once, at creation, and nowhere else.
 */

export type ApiKeySummary = { id: ApiKeyId; name: string; createdAt: string; lastUsedAt: string | null };
export type CreatedApiKey = { id: ApiKeyId; name: string; plaintext: string; createdAt: string };

export async function createApiKeyIn(dbOrTx: DbOrTx, eventId: EventId, label: string): Promise<CreatedApiKey> {
  const name = label.trim();
  if (!name) throw new AppError("VALIDATION", "Key label is required");

  // 32 random bytes, base64url-encoded — the same alphabet `apiKeyAuth()`
  // expects, prefixed so a leaked key is recognizable as this app's at a
  // glance (the same convention as Stripe's `sk_live_`).
  const plaintext = `ob_live_${toBase64Url(randomBytes(32))}`;
  const keyHash = await sha256(plaintext);

  const [row] = await dbOrTx.insert(apiKeys).values({ eventId, name, keyHash }).returning();
  if (!row) throw new AppError("INTERNAL", "Could not create API key");

  return { id: apiKeyIdSchema.parse(row.id), name: row.name, plaintext, createdAt: row.createdAt.toISOString() };
}

export async function listApiKeysIn(dbOrTx: DbOrTx, eventId: EventId): Promise<ApiKeySummary[]> {
  const rows = await dbOrTx.select({ id: apiKeys.id, name: apiKeys.name, createdAt: apiKeys.createdAt, lastUsedAt: apiKeys.lastUsedAt })
    .from(apiKeys)
    .where(eq(apiKeys.eventId, eventId))
    .orderBy(desc(apiKeys.createdAt));
  return rows.map((row) => ({
    id: apiKeyIdSchema.parse(row.id),
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
  }));
}

// Event-scoped by construction (`eq(apiKeys.eventId, eventId)` in the WHERE,
// not just `eq(apiKeys.id, id)`): an id from another event matches nothing
// and revokes nothing — the same IDOR-proofing every event-scoped delete in
// this repo uses. A second revoke of an already-revoked id is a silent
// no-op, same as `deleteVocabItem`.
export async function revokeApiKeyIn(dbOrTx: DbOrTx, eventId: EventId, id: ApiKeyId): Promise<void> {
  await dbOrTx.delete(apiKeys).where(and(eq(apiKeys.id, id), eq(apiKeys.eventId, eventId)));
}

export const createApiKey = (eventId: EventId, label: string) => createApiKeyIn(db, eventId, label);
export const listApiKeys = (eventId: EventId) => listApiKeysIn(db, eventId);
export const revokeApiKey = (eventId: EventId, id: ApiKeyId) => revokeApiKeyIn(db, eventId, id);
