import { z } from "zod";
import { isAppError } from "@/shared/lib/errors";
import { bulkSendPreviewFingerprint } from "./bulk-send-attempt";

export const BULK_SEND_RECOVERY_VERSION = 1 as const;
export const MAX_BULK_SEND_RECOVERY_RECIPIENTS = 2_000;
export const MAX_BULK_SEND_RECOVERY_SUBJECT_LENGTH = 200;
export const MAX_BULK_SEND_RECOVERY_BODY_LENGTH = 20_000;
export const MAX_BULK_SEND_RECOVERY_SERIALIZED_LENGTH = 2_000_000;

const MAX_SCOPE_LENGTH = 240;
const MAX_RECIPIENT_ID_LENGTH = 200;
const MAX_RECIPIENT_NAME_LENGTH = 500;
const MAX_RECIPIENT_EMAIL_LENGTH = 320;
const MAX_RENDERED_SUBJECT_LENGTH = 2_000;
const MAX_RENDERED_BODY_LENGTH = 100_000;
const MAX_RESULT_REASON_LENGTH = 2_000;
const MAX_FINGERPRINT_LENGTH = 200_000;
const MAX_ATTEMPT_STORAGE_KEY_LENGTH = 500;

export const bulkSendRecoverySurfaceSchema = z.enum(["speaker", "crm"]);
export type BulkSendRecoverySurface = z.infer<typeof bulkSendRecoverySurfaceSchema>;

export const bulkSendRecoveryIdentitySchema = z.object({
  surface: bulkSendRecoverySurfaceSchema,
  scope: z.string().min(1).max(MAX_SCOPE_LENGTH),
}).strict();
export type BulkSendRecoveryIdentity = z.infer<typeof bulkSendRecoveryIdentitySchema>;

export const bulkSendRecoveryRecipientSchema = z.object({
  id: z.string().min(1).max(MAX_RECIPIENT_ID_LENGTH),
  name: z.string().max(MAX_RECIPIENT_NAME_LENGTH),
  // Resolved CRM segments intentionally retain ids that are outside their
  // short named preview sample. Those rows use an empty email until the
  // server resolves them, so this is bounded but not an email validator.
  email: z.string().max(MAX_RECIPIENT_EMAIL_LENGTH),
}).strict();
export type BulkSendRecoveryRecipient = z.infer<typeof bulkSendRecoveryRecipientSchema>;

export const bulkSendRecoveryPreviewSchema = z.object({
  recipientEmail: z.string().max(MAX_RECIPIENT_EMAIL_LENGTH),
  recipientName: z.string().max(MAX_RECIPIENT_NAME_LENGTH),
  subject: z.string().max(MAX_RENDERED_SUBJECT_LENGTH),
  bodyHtml: z.string().max(MAX_RENDERED_BODY_LENGTH),
  bodyText: z.string().max(MAX_RENDERED_BODY_LENGTH),
}).strict();
export type BulkSendRecoveryPreview = z.infer<typeof bulkSendRecoveryPreviewSchema>;

export const bulkSendRecoveryBatchResultSchema = z.object({
  queued: z.int().nonnegative().max(MAX_BULK_SEND_RECOVERY_RECIPIENTS),
  alreadyQueued: z.int().nonnegative().max(MAX_BULK_SEND_RECOVERY_RECIPIENTS),
  skipped: z.int().nonnegative().max(MAX_BULK_SEND_RECOVERY_RECIPIENTS),
  errors: z.array(z.object({
    recipientId: z.string().min(1).max(MAX_RECIPIENT_ID_LENGTH),
    reason: z.string().max(MAX_RESULT_REASON_LENGTH),
  }).strict()).max(MAX_BULK_SEND_RECOVERY_RECIPIENTS),
}).strict();
export type BulkSendRecoveryBatchResult = z.infer<typeof bulkSendRecoveryBatchResultSchema>;

const nonBlankBounded = (max: number) => z.string().max(max).refine((value) => value.trim().length > 0, "Required");

export const bulkSendRecoverySnapshotSchema = z.object({
  version: z.literal(BULK_SEND_RECOVERY_VERSION),
  surface: bulkSendRecoverySurfaceSchema,
  scope: z.string().min(1).max(MAX_SCOPE_LENGTH),
  recipients: z.array(bulkSendRecoveryRecipientSchema).min(1).max(MAX_BULK_SEND_RECOVERY_RECIPIENTS),
  previewRecipients: z.array(bulkSendRecoveryRecipientSchema).min(1).max(MAX_BULK_SEND_RECOVERY_RECIPIENTS),
  subject: nonBlankBounded(MAX_BULK_SEND_RECOVERY_SUBJECT_LENGTH),
  bodyHtml: nonBlankBounded(MAX_BULK_SEND_RECOVERY_BODY_LENGTH),
  previewRecipientId: z.string().min(1).max(MAX_RECIPIENT_ID_LENGTH),
  approvedPreview: bulkSendRecoveryPreviewSchema,
  sendId: z.uuid(),
  attemptStorageKey: z.string().min(1).max(MAX_ATTEMPT_STORAGE_KEY_LENGTH).startsWith("openboard:bulk-send:"),
  fingerprint: z.string().min(1).max(MAX_FINGERPRINT_LENGTH),
  completedResults: z.array(bulkSendRecoveryBatchResultSchema).max(MAX_BULK_SEND_RECOVERY_RECIPIENTS),
}).strict().superRefine((snapshot, context) => {
  const recipientIds = new Set<string>();
  for (const recipient of snapshot.recipients) {
    if (recipientIds.has(recipient.id)) {
      context.addIssue({ code: "custom", path: ["recipients"], message: "Recipient ids must be unique" });
      break;
    }
    recipientIds.add(recipient.id);
  }

  const previewIds = new Set<string>();
  for (const recipient of snapshot.previewRecipients) {
    if (!recipientIds.has(recipient.id)) {
      context.addIssue({ code: "custom", path: ["previewRecipients"], message: "Preview recipients must belong to the audience" });
    }
    if (previewIds.has(recipient.id)) {
      context.addIssue({ code: "custom", path: ["previewRecipients"], message: "Preview recipient ids must be unique" });
      break;
    }
    previewIds.add(recipient.id);
  }

  if (!previewIds.has(snapshot.previewRecipientId)) {
    context.addIssue({ code: "custom", path: ["previewRecipientId"], message: "The approved preview recipient is not available" });
  }

  const expectedFingerprint = bulkSendPreviewFingerprint({
    contactIds: snapshot.recipients.map((recipient) => recipient.id),
    previewContactId: snapshot.previewRecipientId,
    subject: snapshot.subject,
    bodyHtml: snapshot.bodyHtml,
  });
  if (snapshot.fingerprint !== expectedFingerprint) {
    context.addIssue({ code: "custom", path: ["fingerprint"], message: "Fingerprint does not match the recovered draft" });
  }
});
export type BulkSendRecoverySnapshot = z.infer<typeof bulkSendRecoverySnapshotSchema>;

export type BulkSendRecoveryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type BulkSendRecoveryFailureReason =
  | "invalid_identity"
  | "invalid_snapshot"
  | "missing"
  | "corrupt"
  | "identity_mismatch"
  | "send_id_mismatch"
  | "storage_unavailable"
  | "write_unverified"
  | "remove_unverified";

type Failure = { ok: false; reason: BulkSendRecoveryFailureReason };

export type LoadBulkSendRecoveryResult = { ok: true; snapshot: BulkSendRecoverySnapshot; storageKey: string } | Failure;
export type PersistBulkSendRecoveryResult = { ok: true; snapshot: BulkSendRecoverySnapshot; storageKey: string } | Failure;
export type RemoveBulkSendRecoveryResult = { ok: true; removed: boolean; storageKey: string } | Failure;

/** The key identifies only the owning surface and resource, never its audience or message. */
export function bulkSendRecoveryStorageKey(identity: BulkSendRecoveryIdentity): string {
  // Keep discovery stable across schema versions. The version belongs in the
  // value so an older, unreadable recovery can block a new send instead of
  // disappearing behind a new key and being overwritten.
  return `openboard:bulk-send-recovery:${identity.surface}:${encodeURIComponent(identity.scope)}`;
}

function parsedIdentity(identity: unknown): BulkSendRecoveryIdentity | null {
  if (!identity || typeof identity !== "object") return null;
  const candidate = identity as Record<string, unknown>;
  const parsed = bulkSendRecoveryIdentitySchema.safeParse({ surface: candidate.surface, scope: candidate.scope });
  return parsed.success ? parsed.data : null;
}

function parsedSnapshot(raw: string): BulkSendRecoverySnapshot | null {
  if (raw.length > MAX_BULK_SEND_RECOVERY_SERIALIZED_LENGTH) return null;
  try {
    const parsed = bulkSendRecoverySnapshotSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function loadBulkSendRecovery(storage: BulkSendRecoveryStorage, identity: BulkSendRecoveryIdentity): LoadBulkSendRecoveryResult {
  const expected = parsedIdentity(identity);
  if (!expected) return { ok: false, reason: "invalid_identity" };
  const storageKey = bulkSendRecoveryStorageKey(expected);
  try {
    const raw = storage.getItem(storageKey);
    if (raw === null) return { ok: false, reason: "missing" };
    const snapshot = parsedSnapshot(raw);
    if (!snapshot) return { ok: false, reason: "corrupt" };
    if (snapshot.surface !== expected.surface || snapshot.scope !== expected.scope) {
      return { ok: false, reason: "identity_mismatch" };
    }
    return { ok: true, snapshot, storageKey };
  } catch {
    return { ok: false, reason: "storage_unavailable" };
  }
}

export function persistBulkSendRecovery(storage: BulkSendRecoveryStorage, value: unknown): PersistBulkSendRecoveryResult {
  const parsed = bulkSendRecoverySnapshotSchema.safeParse(value);
  if (!parsed.success) return { ok: false, reason: "invalid_snapshot" };

  const snapshot = parsed.data;
  const storageKey = bulkSendRecoveryStorageKey(snapshot);
  const raw = JSON.stringify(snapshot);
  if (raw.length > MAX_BULK_SEND_RECOVERY_SERIALIZED_LENGTH) return { ok: false, reason: "invalid_snapshot" };
  try {
    const existingRaw = storage.getItem(storageKey);
    if (existingRaw !== null) {
      const existing = parsedSnapshot(existingRaw);
      if (!existing) return { ok: false, reason: "corrupt" };
      if (existing.surface !== snapshot.surface || existing.scope !== snapshot.scope) {
        return { ok: false, reason: "identity_mismatch" };
      }
      if (existing.sendId !== snapshot.sendId) return { ok: false, reason: "send_id_mismatch" };
    }
    storage.setItem(storageKey, raw);
    if (storage.getItem(storageKey) !== raw) return { ok: false, reason: "write_unverified" };
    return { ok: true, snapshot, storageKey };
  } catch {
    return { ok: false, reason: "storage_unavailable" };
  }
}

export function removeBulkSendRecovery(
  storage: BulkSendRecoveryStorage,
  expectedValue: BulkSendRecoveryIdentity & { sendId: string },
): RemoveBulkSendRecoveryResult {
  const expected = parsedIdentity(expectedValue);
  if (!expected || !z.uuid().safeParse(expectedValue.sendId).success) return { ok: false, reason: "invalid_identity" };
  const storageKey = bulkSendRecoveryStorageKey(expected);
  try {
    const raw = storage.getItem(storageKey);
    if (raw === null) return { ok: true, removed: false, storageKey };
    const snapshot = parsedSnapshot(raw);
    if (!snapshot) return { ok: false, reason: "corrupt" };
    if (snapshot.surface !== expected.surface || snapshot.scope !== expected.scope) {
      return { ok: false, reason: "identity_mismatch" };
    }
    if (snapshot.sendId !== expectedValue.sendId) return { ok: false, reason: "send_id_mismatch" };
    storage.removeItem(storageKey);
    if (storage.getItem(storageKey) !== null) return { ok: false, reason: "remove_unverified" };
    return { ok: true, removed: true, storageKey };
  } catch {
    return { ok: false, reason: "storage_unavailable" };
  }
}

export type BulkSendFailureClassification = "definite" | "unknown";

/**
 * Once a batch has completed, any later exception leaves a partially sent
 * audience. The first call is definite only for a structured, non-500
 * rejection; network failures and INTERNAL responses may have committed.
 */
export function classifyBulkSendFailure(
  error: unknown,
  completedResults: readonly BulkSendRecoveryBatchResult[],
  retryingRecovery = false,
): BulkSendFailureClassification {
  if (retryingRecovery || completedResults.length > 0 || !isAppError(error) || error.code === "INTERNAL") return "unknown";
  return "definite";
}
