import { and, desc, eq, sql } from "drizzle-orm";
import { sha256 } from "@/shared/lib/crypto";
import { db, type DbOrTx } from "@/db/client";
import { apiKeys } from "@/db/schema";
import { apiKeyIdSchema, type ApiKeyId, type EventId } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { apiKeyCreationOperationSchema, type ApiKeyCreationOperation } from "../api-key-creation";

/**
 * API key lifecycle — create/list/revoke only. Verification lives in
 * `features/auth`'s `apiKeyAuth()` (M06a): one implementation of hashed-bearer
 * auth in the repo, this module owns issuing and retiring rows, never
 * checking them.
 *
 * The frozen `api_keys` schema (`drizzle/0000_init.sql`) stores `name` and
 * `key_hash` only — no `last_four` column. A key's last four characters are
 * therefore never persisted or fetched after creation; the label is what an
 * organizer tells two keys apart later. A receipt-backed replay may echo only
 * the identical caller-resupplied plaintext after its hash is proven.
 */

export type ApiKeySummary = { id: ApiKeyId; name: string; createdAt: string; lastUsedAt: string | null };
export type CreatedApiKey = { id: ApiKeyId; name: string; plaintext: string; createdAt: string };

type CreatedRow = { id: string; event_id: string; name: string; key_hash: string; created_at: string | Date };

const REPLAY_CONFLICT = "This creation attempt was already used for different API key details";
const REVOKED_CONFLICT = "This creation completed, but the API key was later revoked. Start a new creation.";

function isUniqueViolation(error: unknown): boolean {
  for (let current: unknown = error, depth = 0; current && depth < 5; depth += 1) {
    const entry = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (entry.code === "23505") return true;
    if (typeof entry.message === "string" && /duplicate key value|unique constraint/iu.test(entry.message)) return true;
    current = entry.cause;
  }
  return false;
}

async function creationFingerprint(eventId: EventId, name: string, keyHash: string): Promise<string> {
  return sha256(JSON.stringify({ eventId, name, keyHash }));
}

async function recoverCreatedApiKey(
  dbOrTx: DbOrTx,
  eventId: EventId,
  operation: ApiKeyCreationOperation,
  payloadFingerprint: string,
  keyHash: string,
): Promise<CreatedApiKey | null> {
  // operation_id is globally unique. An event predicate here would turn an id
  // already consumed by another event into a cross-event success opportunity.
  const receiptResult = await dbOrTx.execute<{ event_id: string; payload_fingerprint: string }>(sql`
    SELECT event_id, payload_fingerprint
    FROM api_key_creation_receipts
    WHERE operation_id = ${operation.operationId}
  `);
  const receipt = (receiptResult.rows ?? [])[0];
  if (!receipt) {
    const collision = await dbOrTx.execute<{ id: string }>(sql`
      SELECT id FROM api_keys WHERE id = ${operation.operationId}
    `);
    if ((collision.rows ?? []).length > 0) throw new AppError("CONFLICT", REPLAY_CONFLICT);
    return null;
  }
  if (receipt.event_id !== eventId || receipt.payload_fingerprint !== payloadFingerprint) {
    throw new AppError("CONFLICT", REPLAY_CONFLICT);
  }

  const keyResult = await dbOrTx.execute<CreatedRow>(sql`
    SELECT id, event_id, name, key_hash, created_at
    FROM api_keys
    WHERE id = ${operation.operationId}
  `);
  const row = (keyResult.rows ?? [])[0];
  if (!row) throw new AppError("CONFLICT", REVOKED_CONFLICT);
  if (row.event_id !== eventId || row.name !== operation.label || row.key_hash !== keyHash) {
    throw new AppError("CONFLICT", REPLAY_CONFLICT);
  }
  return {
    id: apiKeyIdSchema.parse(row.id),
    name: row.name,
    plaintext: operation.plaintext,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export async function createApiKeyIn(dbOrTx: DbOrTx, eventId: EventId, rawOperation: unknown): Promise<CreatedApiKey> {
  const operation = apiKeyCreationOperationSchema.parse(rawOperation);
  const keyHash = await sha256(operation.plaintext);
  const payloadFingerprint = await creationFingerprint(eventId, operation.label, keyHash);

  const recovered = await recoverCreatedApiKey(dbOrTx, eventId, operation, payloadFingerprint, keyHash);
  if (recovered) return recovered;

  try {
    // One statement is the atomic boundary even for the production HTTP
    // driver: either both durable receipt and credential commit, or neither.
    const result = await dbOrTx.execute<CreatedRow>(sql`
      WITH receipt AS (
        INSERT INTO api_key_creation_receipts (operation_id, event_id, payload_fingerprint)
        VALUES (${operation.operationId}, ${eventId}, ${payloadFingerprint})
        RETURNING operation_id
      ), created AS (
        INSERT INTO api_keys (id, event_id, name, key_hash)
        SELECT operation_id, ${eventId}, ${operation.label}, ${keyHash}
        FROM receipt
        RETURNING id, event_id, name, key_hash, created_at
      )
      SELECT id, event_id, name, key_hash, created_at FROM created
    `);
    const row = (result.rows ?? [])[0];
    if (!row) throw new AppError("INTERNAL", "Could not create API key");
    return {
      id: apiKeyIdSchema.parse(row.id),
      name: row.name,
      plaintext: operation.plaintext,
      createdAt: new Date(row.created_at).toISOString(),
    };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const replay = await recoverCreatedApiKey(dbOrTx, eventId, operation, payloadFingerprint, keyHash);
    if (replay) return replay;
    throw new AppError("CONFLICT", REPLAY_CONFLICT);
  }
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

export const createApiKey = (eventId: EventId, operation: ApiKeyCreationOperation) => createApiKeyIn(db, eventId, operation);
export const listApiKeys = (eventId: EventId) => listApiKeysIn(db, eventId);
export const revokeApiKey = (eventId: EventId, id: ApiKeyId) => revokeApiKeyIn(db, eventId, id);
