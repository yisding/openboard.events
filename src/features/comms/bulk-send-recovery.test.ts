import { describe, expect, it } from "vitest";
import { AppError } from "@/shared/lib/errors";
import { bulkSendPreviewFingerprint } from "./bulk-send-attempt";
import {
  BULK_SEND_RECOVERY_VERSION,
  MAX_BULK_SEND_RECOVERY_BODY_LENGTH,
  MAX_BULK_SEND_RECOVERY_RECIPIENTS,
  MAX_BULK_SEND_RECOVERY_SUBJECT_LENGTH,
  bulkSendRecoverySnapshotSchema,
  bulkSendRecoveryStorageKey,
  classifyBulkSendFailure,
  loadBulkSendRecovery,
  persistBulkSendRecovery,
  removeBulkSendRecovery,
  type BulkSendRecoverySnapshot,
  type BulkSendRecoveryStorage,
} from "./bulk-send-recovery";

const recipient = (n: number) => ({
  id: `b1000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  name: `Recipient ${n}`,
  email: `recipient-${n}@example.com`,
});

function snapshot(overrides: Partial<BulkSendRecoverySnapshot> = {}): BulkSendRecoverySnapshot {
  const recipients = overrides.recipients ?? [recipient(1), recipient(2)];
  const previewRecipients = overrides.previewRecipients ?? recipients;
  const subject = overrides.subject ?? "Program update";
  const bodyHtml = overrides.bodyHtml ?? "<p>Hello {{contact.name}}</p>";
  const previewRecipientId = overrides.previewRecipientId ?? previewRecipients[0]?.id ?? recipient(1).id;
  return {
    version: BULK_SEND_RECOVERY_VERSION,
    surface: "speaker",
    scope: "b2000000-0000-4000-8000-000000000001",
    recipients,
    previewRecipients,
    subject,
    bodyHtml,
    previewRecipientId,
    approvedPreview: {
      recipientEmail: "recipient-1@example.com",
      recipientName: "Recipient 1",
      subject: "Program update",
      bodyHtml: "<p>Hello Recipient 1</p>",
      bodyText: "Hello Recipient 1",
    },
    sendId: "b3000000-0000-4000-8000-000000000001",
    attemptStorageKey: "openboard:bulk-send:speaker-selected:opaque-fingerprint-hash",
    fingerprint: bulkSendPreviewFingerprint({
      contactIds: recipients.map((row) => row.id),
      previewContactId: previewRecipientId,
      subject,
      bodyHtml,
    }),
    completedResults: [],
    confirmedResult: null,
    ...overrides,
  };
}

function memoryStorage(): BulkSendRecoveryStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

describe("bulk send recovery snapshot", () => {
  it("round-trips a versioned speaker snapshot with its frozen rendered preview", () => {
    const storage = memoryStorage();
    const value = snapshot();

    const persisted = persistBulkSendRecovery(storage, value);
    expect(persisted).toMatchObject({ ok: true });
    expect(loadBulkSendRecovery(storage, value)).toEqual({
      ok: true,
      snapshot: value,
      storageKey: bulkSendRecoveryStorageKey(value),
    });
  });

  it("accepts a CRM snapshot and generic results from completed batches", () => {
    const value = snapshot({
      surface: "crm",
      completedResults: [{
        queued: 1,
        alreadyQueued: 1,
        skipped: 0,
        errors: [{ recipientId: recipient(2).id, reason: "Not linked to an event" }],
      }],
    });

    expect(bulkSendRecoverySnapshotSchema.safeParse(value).success).toBe(true);
  });

  it("enforces audience and draft bounds", () => {
    const tooMany = Array.from({ length: MAX_BULK_SEND_RECOVERY_RECIPIENTS + 1 }, (_, index) => recipient(index));
    expect(bulkSendRecoverySnapshotSchema.safeParse(snapshot({ recipients: tooMany, previewRecipients: [recipient(0)] })).success).toBe(false);
    expect(bulkSendRecoverySnapshotSchema.safeParse(snapshot({ subject: "s".repeat(MAX_BULK_SEND_RECOVERY_SUBJECT_LENGTH + 1) })).success).toBe(false);
    expect(bulkSendRecoverySnapshotSchema.safeParse(snapshot({ bodyHtml: "b".repeat(MAX_BULK_SEND_RECOVERY_BODY_LENGTH + 1) })).success).toBe(false);
  });

  it("rejects a preview outside the audience, duplicate recipients, and a stale fingerprint", () => {
    const outside = recipient(3);
    expect(bulkSendRecoverySnapshotSchema.safeParse(snapshot({ previewRecipients: [outside], previewRecipientId: outside.id })).success).toBe(false);
    expect(bulkSendRecoverySnapshotSchema.safeParse(snapshot({ recipients: [recipient(1), recipient(1)] })).success).toBe(false);
    expect(bulkSendRecoverySnapshotSchema.safeParse(snapshot({ fingerprint: "approved-for-something-else" })).success).toBe(false);
  });
});

describe("bulk send recovery storage", () => {
  it("scopes the key without leaking recipient or message content", () => {
    const value = snapshot({ scope: "event/one:chosen" });
    const key = bulkSendRecoveryStorageKey(value);

    expect(key).toContain(encodeURIComponent(value.scope));
    expect(key).not.toContain(value.subject);
    expect(key).not.toContain(value.bodyHtml);
    expect(key).not.toContain(recipient(1).email);
  });

  it("fails closed for missing, malformed JSON, invalid snapshots, and mismatched identities", () => {
    const storage = memoryStorage();
    const value = snapshot();
    const key = bulkSendRecoveryStorageKey(value);

    expect(loadBulkSendRecovery(storage, value)).toEqual({ ok: false, reason: "missing" });
    storage.setItem(key, "{not json");
    expect(loadBulkSendRecovery(storage, value)).toEqual({ ok: false, reason: "corrupt" });
    storage.setItem(key, JSON.stringify({ ...value, version: 999 }));
    expect(loadBulkSendRecovery(storage, value)).toEqual({ ok: false, reason: "corrupt" });
    storage.setItem(key, JSON.stringify(snapshot({ scope: "another-event" })));
    expect(loadBulkSendRecovery(storage, value)).toEqual({ ok: false, reason: "identity_mismatch" });
  });

  it("reports read, write, and remove exceptions instead of pretending recovery is safe", () => {
    const value = snapshot();
    const throwsOnRead: BulkSendRecoveryStorage = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    const throwsOnWrite: BulkSendRecoveryStorage = {
      getItem: () => null,
      setItem: () => { throw new Error("quota"); },
      removeItem: () => undefined,
    };
    const storage = memoryStorage();
    expect(persistBulkSendRecovery(storage, value).ok).toBe(true);
    const throwsOnRemove: BulkSendRecoveryStorage = {
      getItem: storage.getItem,
      setItem: storage.setItem,
      removeItem: () => { throw new Error("blocked"); },
    };

    expect(loadBulkSendRecovery(throwsOnRead, value)).toEqual({ ok: false, reason: "storage_unavailable" });
    expect(persistBulkSendRecovery(throwsOnWrite, value)).toEqual({ ok: false, reason: "storage_unavailable" });
    expect(removeBulkSendRecovery(throwsOnRemove, value)).toEqual({ ok: false, reason: "storage_unavailable" });
  });

  it("verifies writes and removes only the matching attempt", () => {
    const value = snapshot();
    const discardsWrites: BulkSendRecoveryStorage = {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    expect(persistBulkSendRecovery(discardsWrites, value)).toEqual({ ok: false, reason: "write_unverified" });

    const storage = memoryStorage();
    expect(persistBulkSendRecovery(storage, value).ok).toBe(true);
    expect(removeBulkSendRecovery(storage, { ...value, sendId: "b3000000-0000-4000-8000-000000000002" })).toEqual({ ok: false, reason: "send_id_mismatch" });
    expect(loadBulkSendRecovery(storage, value).ok).toBe(true);
    expect(removeBulkSendRecovery(storage, value)).toMatchObject({ ok: true, removed: true });
    expect(loadBulkSendRecovery(storage, value)).toEqual({ ok: false, reason: "missing" });
  });

  it("never overwrites unreadable state or a different unconfirmed attempt", () => {
    const storage = memoryStorage();
    const value = snapshot();
    const key = bulkSendRecoveryStorageKey(value);
    storage.setItem(key, "{old unreadable recovery");
    expect(persistBulkSendRecovery(storage, value)).toEqual({ ok: false, reason: "corrupt" });
    expect(storage.getItem(key)).toBe("{old unreadable recovery");

    storage.removeItem(key);
    expect(persistBulkSendRecovery(storage, value).ok).toBe(true);
    const differentAttempt = snapshot({ sendId: "b3000000-0000-4000-8000-000000000002" });
    expect(persistBulkSendRecovery(storage, differentAttempt)).toEqual({ ok: false, reason: "send_id_mismatch" });
    expect(loadBulkSendRecovery(storage, value)).toMatchObject({ ok: true, snapshot: value });
  });
});

describe("bulk send failure classification", () => {
  it("treats a first-call structured rejection as definite, except INTERNAL", () => {
    expect(classifyBulkSendFailure(new AppError("VALIDATION", "Invalid message"), [])).toBe("definite");
    expect(classifyBulkSendFailure(new AppError("INTERNAL", "Database unavailable"), [])).toBe("unknown");
    expect(classifyBulkSendFailure(new TypeError("Connection lost"), [])).toBe("unknown");
  });

  it("treats a later failure as unknown after any earlier batch completed", () => {
    const completed = [{ queued: 200, alreadyQueued: 0, skipped: 0, errors: [] }];
    expect(classifyBulkSendFailure(new AppError("VALIDATION", "Second batch rejected"), completed)).toBe("unknown");
  });

  it("keeps every failure unknown once the organizer is retrying an ambiguous attempt", () => {
    expect(classifyBulkSendFailure(new AppError("VALIDATION", "Request rejected"), [], true)).toBe("unknown");
    expect(classifyBulkSendFailure(new AppError("FORBIDDEN", "Access changed"), [], true)).toBe("unknown");
  });
});
