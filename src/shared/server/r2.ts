import { getCloudflareContext } from "@opennextjs/cloudflare";
import { AwsClient } from "aws4fetch";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { fileAssets } from "@/db/schema";
import { fileIdSchema, type ContactId, type EventId, type FileId, type FileKind, type MemberRole } from "@/shared/contracts";
import { getEnv } from "@/shared/lib/env";
import { AppError } from "@/shared/lib/errors";

/**
 * The only module in the repository allowed to touch the R2 binding or aws4fetch.
 * File bytes never pass through the Worker: the browser PUTs straight to R2 with a
 * presigned URL, then calls finalize so the server can verify what actually landed.
 */

export type { FileKind };

const MB = 1024 * 1024;
const PRESIGN_PUT_SECONDS = 15 * 60;
const DOWNLOAD_URL_SECONDS = 60 * 60;
const MAX_FILENAME_LENGTH = 128;

/** Hard ceiling a file_requests row may never raise, only lower. */
export const UPLOAD_MAX_SIZE_MB = 100;

export type FileAccess = "public" | "private";
export type KindPolicy = { readonly mimes: readonly string[]; readonly maxSizeMb: number; readonly access: FileAccess };

// SVG is excluded from every public image kind. Sanitizing SVG is its own rabbit
// hole; do not re-add it without solving that first.
const IMAGE_MIMES = ["image/png", "image/jpeg", "image/webp"] as const;

export const KIND_POLICY: Readonly<Record<FileKind, KindPolicy>> = Object.freeze({
  logo: { mimes: IMAGE_MIMES, maxSizeMb: 5, access: "public" },
  background: { mimes: IMAGE_MIMES, maxSizeMb: 5, access: "public" },
  headshot: { mimes: IMAGE_MIMES, maxSizeMb: 5, access: "public" },
  slide: {
    mimes: [
      "application/pdf",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/vnd.apple.keynote",
      "application/zip",
    ],
    maxSizeMb: 100,
    access: "private",
  },
  attachment: {
    mimes: [
      "application/pdf",
      "image/png",
      "image/jpeg",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/zip",
    ],
    maxSizeMb: 25,
    access: "private",
  },
  // File-request uploads carry no fixed allowlist: the owning file_requests row
  // supplies extensions and a size limit, clamped by UPLOAD_MAX_SIZE_MB.
  upload: { mimes: [], maxSizeMb: UPLOAD_MAX_SIZE_MB, access: "private" },
});

export type PolicyOverride = { extensions: string[]; maxSizeMb: number };

export type ResolvedPolicy = {
  maxBytes: number;
  /** Non-null for fixed-allowlist kinds. */
  mimes: readonly string[] | null;
  /** Non-null for `upload`, whose allowlist is per file request. */
  extensions: readonly string[] | null;
  access: FileAccess;
};

export function isPublicKind(kind: FileKind): boolean {
  return KIND_POLICY[kind].access === "public";
}

function normalizeExtension(value: string): string {
  return value.trim().toLowerCase().replace(/^\./, "");
}

export function fileExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? normalizeExtension(filename.slice(dot)) : "";
}

export function resolvePolicy(kind: FileKind, override?: PolicyOverride): ResolvedPolicy {
  const base = KIND_POLICY[kind];
  if (kind !== "upload") {
    if (override) throw new AppError("VALIDATION", "policyOverride is only valid for kind=upload");
    return { maxBytes: base.maxSizeMb * MB, mimes: base.mimes, extensions: null, access: base.access };
  }
  if (!override) throw new AppError("VALIDATION", "kind=upload requires the owning file request policy");
  const maxSizeMb = Math.min(UPLOAD_MAX_SIZE_MB, override.maxSizeMb);
  if (!(maxSizeMb > 0)) throw new AppError("VALIDATION", "file request size limit must be positive");
  return {
    maxBytes: maxSizeMb * MB,
    mimes: null,
    extensions: override.extensions.map(normalizeExtension).filter(Boolean),
    access: "private",
  };
}

/**
 * Presign-time policy check. The declared mime and size are the client's claim;
 * finalizeUpload re-checks the bytes that actually landed.
 */
export function assertUploadAllowed(input: {
  kind: FileKind;
  filename: string;
  mime: string;
  sizeBytes: number;
  policyOverride?: PolicyOverride;
}): ResolvedPolicy {
  const policy = resolvePolicy(input.kind, input.policyOverride);
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) {
    throw new AppError("VALIDATION", "sizeBytes must be a positive integer");
  }
  if (input.sizeBytes > policy.maxBytes) {
    throw new AppError("VALIDATION", `${input.kind} files are limited to ${Math.floor(policy.maxBytes / MB)} MB`);
  }
  if (policy.mimes && !policy.mimes.includes(input.mime.toLowerCase())) {
    throw new AppError("VALIDATION", `${input.mime} is not an accepted type for ${input.kind}`);
  }
  if (policy.extensions) {
    const extension = fileExtension(sanitizeFilename(input.filename));
    if (!extension || !policy.extensions.includes(extension)) {
      throw new AppError("VALIDATION", `this file request accepts ${policy.extensions.join(", ")}`);
    }
  }
  return policy;
}

/**
 * Reduces any client string to a single safe path segment: no traversal, no
 * separators, no control characters, and short enough to keep the key bounded.
 */
export function sanitizeFilename(raw: string): string {
  const lastSegment = raw.normalize("NFC").split(/[\\/]+/).filter((part) => part.length > 0).pop() ?? "";
  const printable = [...lastSegment]
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code > 0x1f && code !== 0x7f;
    })
    .join("")
    .replace(/^[.\s]+/, "")
    .trim();
  if (printable.length === 0) return "file";
  if (printable.length <= MAX_FILENAME_LENGTH) return printable;
  const dot = printable.lastIndexOf(".");
  const extension = dot > 0 && printable.length - dot <= 17 ? printable.slice(dot) : "";
  return `${printable.slice(0, MAX_FILENAME_LENGTH - extension.length)}${extension}`;
}

/** Keys are always server-generated; a client-supplied key is never accepted. */
export function buildObjectKey(input: { eventId: EventId; kind: FileKind; fileId: string; filename: string }): string {
  return `evt_${input.eventId}/${input.kind}/${input.fileId}/${sanitizeFilename(input.filename)}`;
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

/** Defends against a renamed executable claiming an image mime. */
export function sniffMatchesMime(mime: string, bytes: Uint8Array): boolean {
  switch (mime.toLowerCase()) {
    case "image/png":
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/jpeg":
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case "image/webp":
      return startsWith(bytes, [0x52, 0x49, 0x46, 0x46])
        && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
    default:
      return true;
  }
}

export type FileRequester =
  | { kind: "admin"; role?: MemberRole }
  | { kind: "contact"; contactId: ContactId };

/**
 * Pure access decision. `linkedContactIds` is every contact the file is attached
 * to through a file request, a task upload, or a submission they participate in.
 */
export function decideFileAccess(input: {
  uploadedByContactId: string | null;
  linkedContactIds: readonly string[];
  requester: FileRequester;
}): boolean {
  if (input.requester.kind === "admin") return true;
  const { contactId } = input.requester;
  return input.uploadedByContactId === contactId || input.linkedContactIds.includes(contactId);
}

// The binding type is inferred rather than named: wrangler generates the
// CloudflareEnv interface without the runtime type globals in scope.
function filesBucket() {
  try {
    const bucket = getCloudflareContext().env.FILES;
    if (bucket) return bucket;
  } catch {
    // Outside a Cloudflare context there is no binding to hand back.
  }
  throw new AppError("INTERNAL", "R2 FILES binding is not available");
}

type R2Config = { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string };

function r2Config(): R2Config {
  const env = getEnv();
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_BUCKET_NAME) {
    throw new AppError("INTERNAL", "R2 credentials are not configured");
  }
  return {
    accountId: env.R2_ACCOUNT_ID,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    bucket: env.R2_BUCKET_NAME,
  };
}

export function objectUrl(config: R2Config, key: string): URL {
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  return new URL(`https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}/${encoded}`);
}

async function presign(key: string, method: "PUT" | "GET", expiresInSeconds: number, headers?: Record<string, string>): Promise<string> {
  const config = r2Config();
  const url = objectUrl(config, key);
  url.searchParams.set("X-Amz-Expires", String(expiresInSeconds));
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: "s3",
    region: "auto",
  });
  const signed = await client.sign(url.toString(), {
    method,
    ...(headers ? { headers } : {}),
    aws: { signQuery: true },
  });
  return signed.url;
}

export interface CreateUploadInput {
  eventId: EventId;
  kind: FileKind;
  filename: string;
  mime: string;
  sizeBytes: number;
  uploadedByUserId?: string;
  uploadedByContactId?: string;
  policyOverride?: PolicyOverride;
}

export interface CreateUploadResult {
  fileId: FileId;
  uploadUrl: string;
  /** Must be sent verbatim on the PUT — they are part of the signature. */
  requiredHeaders: Record<string, string>;
}

/**
 * file_assets has no status column, so a row means "presigned", not "ready".
 * Callers must only persist a fileId into an owning column after finalizeUpload
 * returns ready; cleanupOrphanUploads sweeps whatever never got there.
 */
export async function createUpload(input: CreateUploadInput): Promise<CreateUploadResult> {
  assertUploadAllowed(input);
  const fileId = fileIdSchema.parse(crypto.randomUUID());
  const filename = sanitizeFilename(input.filename);
  const r2Key = buildObjectKey({ eventId: input.eventId, kind: input.kind, fileId, filename });
  await db.insert(fileAssets).values({
    id: fileId,
    eventId: input.eventId,
    kind: input.kind,
    r2Key,
    filename,
    mime: input.mime,
    sizeBytes: input.sizeBytes,
    ...(input.uploadedByUserId ? { uploadedByUserId: input.uploadedByUserId } : {}),
    ...(input.uploadedByContactId ? { uploadedByContactId: input.uploadedByContactId } : {}),
  });
  const uploadUrl = await presign(r2Key, "PUT", PRESIGN_PUT_SECONDS, { "content-type": input.mime });
  return { fileId, uploadUrl, requiredHeaders: { "Content-Type": input.mime } };
}

export type FinalizeResult = { status: "ready" } | { status: "rejected"; reason: string };

async function purge(key: string, fileId: FileId): Promise<void> {
  try {
    await filesBucket().delete(key);
  } finally {
    // Leaving the row behind would let a caller that already holds the fileId
    // point at nothing, so the row goes even if the object delete failed.
    await db.delete(fileAssets).where(eq(fileAssets.id, fileId));
  }
}

/**
 * Authoritative post-upload check: presign constrains the claim, this constrains
 * the bytes. For kind=upload the per-request size limit is enforced at presign;
 * here only the hard ceiling applies, because the owning file_requests row is
 * not linked until the task completion writes file_uploads.
 */
export async function finalizeUpload(fileId: string): Promise<FinalizeResult> {
  const id = fileIdSchema.parse(fileId);
  const [asset] = await db
    .select({ id: fileAssets.id, kind: fileAssets.kind, mime: fileAssets.mime, r2Key: fileAssets.r2Key })
    .from(fileAssets)
    .where(eq(fileAssets.id, id))
    .limit(1);
  if (!asset) throw new AppError("NOT_FOUND", "Upload not found");

  const maxBytes = KIND_POLICY[asset.kind].maxSizeMb * MB;
  const head = await filesBucket().head(asset.r2Key);
  if (!head) {
    await purge(asset.r2Key, id);
    return { status: "rejected", reason: "the upload never reached storage" };
  }
  if (head.size > maxBytes) {
    await purge(asset.r2Key, id);
    return { status: "rejected", reason: `${asset.kind} files are limited to ${Math.floor(maxBytes / MB)} MB` };
  }
  if (IMAGE_MIMES.includes(asset.mime.toLowerCase() as (typeof IMAGE_MIMES)[number])) {
    const ranged = await filesBucket().get(asset.r2Key, { range: { offset: 0, length: 16 } });
    const bytes = ranged ? new Uint8Array(await ranged.arrayBuffer()) : new Uint8Array();
    if (!sniffMatchesMime(asset.mime, bytes)) {
      await purge(asset.r2Key, id);
      return { status: "rejected", reason: "the file contents do not match the declared type" };
    }
  }
  await db.update(fileAssets).set({ sizeBytes: head.size }).where(eq(fileAssets.id, id));
  return { status: "ready" };
}

/**
 * Always scoped by (eventId, fileId, requester) together — a contact id from one
 * event must never unlock a file in another.
 */
export async function getDownloadUrl(eventId: EventId, fileId: string, requester: FileRequester): Promise<string> {
  const id = fileIdSchema.parse(fileId);
  const [asset] = await db
    .select({ r2Key: fileAssets.r2Key, uploadedByContactId: fileAssets.uploadedByContactId })
    .from(fileAssets)
    .where(sql`${fileAssets.id} = ${id} AND ${fileAssets.eventId} = ${eventId}`)
    .limit(1);
  if (!asset) throw new AppError("NOT_FOUND", "File not found");

  const linkedContactIds = requester.kind === "contact" ? await linkedContacts(eventId, id) : [];
  if (!decideFileAccess({ uploadedByContactId: asset.uploadedByContactId, linkedContactIds, requester })) {
    throw new AppError("FORBIDDEN", "You do not have access to this file");
  }
  return presign(asset.r2Key, "GET", DOWNLOAD_URL_SECONDS);
}

async function linkedContacts(eventId: EventId, fileId: FileId): Promise<string[]> {
  const rows = await db.execute<{ contact_id: string }>(sql`
    SELECT fu.contact_id FROM file_uploads fu
      WHERE fu.file_asset_id = ${fileId} AND fu.event_id = ${eventId}
    UNION
    SELECT sp.contact_id FROM file_uploads fu
      JOIN submission_participants sp ON sp.submission_id = fu.submission_id AND sp.event_id = fu.event_id
      WHERE fu.file_asset_id = ${fileId} AND fu.event_id = ${eventId}
    UNION
    SELECT sp.contact_id FROM submission_answers sa
      JOIN submission_participants sp ON sp.submission_id = sa.submission_id AND sp.event_id = sa.event_id
      WHERE sa.event_id = ${eventId} AND sa.value->>'t' = 'file' AND sa.value->>'v' = ${fileId}
  `);
  return (rows.rows ?? []).map((row) => row.contact_id);
}

/**
 * Best-effort daily sweep, wired to M08's cleanup cron slot. One pass is the
 * entire budget — no retry or backfill machinery.
 */
/**
 * Every owning column that makes a file_assets row live. Exported so the runtime
 * sweep and its PGlite regression test cannot drift apart — a missed reference
 * here deletes a file that is still in use.
 */
export const ORPHAN_PREDICATE_SQL = `
  NOT EXISTS (SELECT 1 FROM contacts c WHERE c.headshot_file_id = fa.id)
  AND NOT EXISTS (SELECT 1 FROM events e WHERE e.logo_file_id = fa.id OR e.background_file_id = fa.id)
  AND NOT EXISTS (SELECT 1 FROM file_uploads fu WHERE fu.file_asset_id = fa.id)
  AND NOT EXISTS (
    SELECT 1 FROM submission_answers sa
    WHERE sa.value->>'t' = 'file' AND sa.value->>'v' = fa.id::text
  )
`;

export async function cleanupOrphanUploads(olderThanHours = 24): Promise<{ deleted: number }> {
  const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
  const deleted = await db.execute<{ r2_key: string }>(sql`
    DELETE FROM file_assets fa
    WHERE fa.created_at < ${cutoff} AND ${sql.raw(ORPHAN_PREDICATE_SQL)}
    RETURNING fa.r2_key
  `);
  const keys = (deleted.rows ?? []).map((row) => row.r2_key);
  if (keys.length > 0) {
    const bucket = filesBucket();
    await Promise.allSettled(keys.map((key) => bucket.delete(key)));
  }
  return { deleted: keys.length };
}
