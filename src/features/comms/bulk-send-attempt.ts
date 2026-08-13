import type { ComposeBulkSpeakerEmailResult } from "@/shared/contracts";

const COMPOSE_BATCH_SIZE = 200;

export type BulkSendPreviewFingerprintInput = {
  contactIds: readonly string[];
  previewContactId: string;
  subject: string;
  bodyHtml: string;
};

export type BulkSendAttemptStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type BulkSendAttempt = {
  sendId: string;
  storageKey: string;
};

export type BulkSendAttemptStatus = "active" | "completed" | "abandoned";
export type BulkSendAttemptStorageResult =
  | { ok: true; status: BulkSendAttemptStatus }
  | { ok: false; reason: "missing" | "superseded" | "storage_unavailable" | "write_unverified" };

export function acceptedBulkSendCount(result: { queued: number; alreadyQueued: number }): number {
  return result.queued + result.alreadyQueued;
}

export function bulkSendResultToastOptions(result: {
  queued: number;
  alreadyQueued: number;
  errors: readonly unknown[];
}): { kind: "error" } | undefined {
  return acceptedBulkSendCount(result) === 0 && result.errors.length > 0 ? { kind: "error" } : undefined;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** A preview is approval for one exact audience/message combination. */
export function bulkSendPreviewFingerprint(input: BulkSendPreviewFingerprintInput): string {
  return JSON.stringify([[...input.contactIds].sort(), input.previewContactId, input.subject, input.bodyHtml]);
}

export function canSendBulkMessage(input: {
  canCompose: boolean;
  capped: boolean;
  previewFingerprint: string | null;
  currentFingerprint: string;
}): boolean {
  return input.canCompose && !input.capped && input.previewFingerprint === input.currentFingerprint;
}

export function chunkBulkRecipientIds<T extends string>(recipientIds: readonly T[], size = COMPOSE_BATCH_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < recipientIds.length; start += size) chunks.push([...recipientIds.slice(start, start + size)]);
  return chunks;
}

/** Backwards-compatible name for the event-scoped speaker composer. */
export const chunkContactIds = chunkBulkRecipientIds;

export function mergeBulkSendResults(results: readonly ComposeBulkSpeakerEmailResult[]): ComposeBulkSpeakerEmailResult {
  return results.reduce<ComposeBulkSpeakerEmailResult>(
    (acc, result) => ({
      queued: acc.queued + result.queued,
      alreadyQueued: acc.alreadyQueued + result.alreadyQueued,
      skipped: acc.skipped + result.skipped,
      errors: [...acc.errors, ...result.errors],
      preview: acc.preview ?? result.preview,
    }),
    { queued: 0, alreadyQueued: 0, skipped: 0, errors: [], preview: null },
  );
}

async function fingerprintHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function attemptRecord(raw: string | null): { sendId: string; status: BulkSendAttemptStatus } | null {
  if (!raw) return null;
  // UUID-only records were written before attempt generations gained an
  // explicit state. They remain active so an in-flight recovery is not lost.
  if (UUID_PATTERN.test(raw)) return { sendId: raw, status: "active" };
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value.version !== 1 || typeof value.sendId !== "string" || !UUID_PATTERN.test(value.sendId)) return null;
    if (value.status !== "active" && value.status !== "completed" && value.status !== "abandoned") return null;
    return { sendId: value.sendId, status: value.status };
  } catch {
    return null;
  }
}

function serializedAttempt(sendId: string, status: BulkSendAttemptStatus): string {
  return JSON.stringify({ version: 1, sendId, status });
}

/**
 * Claims one idempotency id for an exact preview. The storage key contains
 * only a SHA-256 digest, never recipient ids or message content. Keeping the
 * entry in localStorage makes an ambiguous partial send safe to preview and
 * retry across a page reload or another tab. Completion and abandonment
 * leave a generation tombstone until an intentional new preview advances
 * it. Browser callers claim this while holding the matching bulk-send
 * recovery lock so concurrent tabs cannot mint different ids.
 */
export async function claimBulkSendAttempt(
  storage: BulkSendAttemptStorage,
  scope: string,
  fingerprint: string,
  createId: () => string = () => crypto.randomUUID(),
): Promise<BulkSendAttempt> {
  const storageKey = `openboard:bulk-send:${scope}:${await fingerprintHash(fingerprint)}`;
  try {
    const existing = attemptRecord(storage.getItem(storageKey));
    if (existing?.status === "active") return { sendId: existing.sendId, storageKey };
  } catch {
    // Storage can be unavailable in a locked-down browser. Sending still works
    // for this page lifetime; only cross-reload recovery is unavailable.
  }
  const sendId = createId();
  try {
    storage.setItem(storageKey, serializedAttempt(sendId, "active"));
  } catch {
    // See the read failure above.
  }
  return { sendId, storageKey };
}

export function verifyBulkSendAttempt(storage: BulkSendAttemptStorage, attempt: BulkSendAttempt): BulkSendAttemptStorageResult {
  try {
    const existing = attemptRecord(storage.getItem(attempt.storageKey));
    if (!existing) return { ok: false, reason: "missing" };
    if (existing.sendId !== attempt.sendId) return { ok: false, reason: "superseded" };
    return { ok: true, status: existing.status };
  } catch {
    return { ok: false, reason: "storage_unavailable" };
  }
}

function transitionBulkSendAttempt(
  storage: BulkSendAttemptStorage,
  attempt: BulkSendAttempt,
  status: Exclude<BulkSendAttemptStatus, "active">,
): BulkSendAttemptStorageResult {
  try {
    const existing = attemptRecord(storage.getItem(attempt.storageKey));
    if (existing && existing.sendId !== attempt.sendId) return { ok: false, reason: "superseded" };
    const raw = serializedAttempt(attempt.sendId, status);
    storage.setItem(attempt.storageKey, raw);
    if (storage.getItem(attempt.storageKey) !== raw) return { ok: false, reason: "write_unverified" };
    return { ok: true, status };
  } catch {
    return { ok: false, reason: "storage_unavailable" };
  }
}

/** Keep a completion tombstone so stale approved previews cannot resurrect it. */
export function completeBulkSendAttempt(storage: BulkSendAttemptStorage, attempt: BulkSendAttempt): BulkSendAttemptStorageResult {
  return transitionBulkSendAttempt(storage, attempt, "completed");
}

/** Explicit abandonment also invalidates every stale tab from this generation. */
export function abandonBulkSendAttempt(storage: BulkSendAttemptStorage, attempt: BulkSendAttempt): BulkSendAttemptStorageResult {
  return transitionBulkSendAttempt(storage, attempt, "abandoned");
}
