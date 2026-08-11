import type { ComposeBulkSpeakerEmailResult } from "@/shared/contracts";

export const COMPOSE_BATCH_SIZE = 200;

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
      skipped: acc.skipped + result.skipped,
      errors: [...acc.errors, ...result.errors],
      preview: acc.preview ?? result.preview,
    }),
    { queued: 0, skipped: 0, errors: [], preview: null },
  );
}

async function fingerprintHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Claims one idempotency id for an exact preview. The storage key contains
 * only a SHA-256 digest, never recipient ids or message content. Keeping the
 * entry in sessionStorage makes an ambiguous partial send safe to preview and
 * retry after a page reload; successful sends remove their own exact entry.
 */
export async function claimBulkSendAttempt(
  storage: BulkSendAttemptStorage,
  scope: string,
  fingerprint: string,
  createId: () => string = () => crypto.randomUUID(),
): Promise<BulkSendAttempt> {
  const storageKey = `openboard:bulk-send:${scope}:${await fingerprintHash(fingerprint)}`;
  try {
    const existing = storage.getItem(storageKey);
    if (existing && UUID_PATTERN.test(existing)) return { sendId: existing, storageKey };
  } catch {
    // Storage can be unavailable in a locked-down browser. Sending still works
    // for this page lifetime; only cross-reload recovery is unavailable.
  }
  const sendId = createId();
  try {
    storage.setItem(storageKey, sendId);
  } catch {
    // See the read failure above.
  }
  return { sendId, storageKey };
}

export function completeBulkSendAttempt(storage: BulkSendAttemptStorage, attempt: BulkSendAttempt): void {
  try {
    // Do not let an old completion remove a newer value claimed for the same
    // fingerprint in another browser task.
    if (storage.getItem(attempt.storageKey) === attempt.sendId) storage.removeItem(attempt.storageKey);
  } catch {
    // A successful send should not be reported as failed because storage was
    // disabled between preview and completion.
  }
}
