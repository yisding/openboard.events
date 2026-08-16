import { getCloudflareContext } from "@opennextjs/cloudflare";
import { AwsClient } from "aws4fetch";
import { eq, inArray, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { fileAssets } from "@/db/schema";
import { fileIdSchema, type ContactId, type EventId, type FileId, type FileKind, type JobStats, type MemberRole, type UserId } from "@/shared/contracts";
import { getEnv } from "@/shared/lib/env";
import { captureError } from "@/shared/lib/error-tracking";
import { AppError } from "@/shared/lib/errors";
import { log } from "@/shared/lib/log";

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
const COPY_TIMEOUT_MS = 20_000;

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
  const extensions = override.extensions.map(normalizeExtension).filter(Boolean);
  // An empty allowlist is a misconfigured request, not "anything goes": say so
  // rather than rejecting every upload with an empty list in the message.
  if (extensions.length === 0) throw new AppError("VALIDATION", "this file request accepts no file types");
  return { maxBytes: maxSizeMb * MB, mimes: null, extensions, access: "private" };
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
  // Truncate by code point: a lone surrogate would later make encodeURIComponent
  // throw while building the object URL, turning a long name into a 500.
  const stem = [...printable.slice(0, printable.length - extension.length)];
  let kept = "";
  for (const character of stem) {
    if (kept.length + character.length > MAX_FILENAME_LENGTH - extension.length) break;
    kept += character;
  }
  return `${kept}${extension}`;
}

/** Keys are always server-generated; a client-supplied key is never accepted. */
export function buildObjectKey(input: { eventId: EventId; kind: FileKind; fileId: string; filename: string }): string {
  return `evt_${input.eventId}/${input.kind}/${input.fileId}/${sanitizeFilename(input.filename)}`;
}

export type ParsedStagingKey = {
  eventId: string;
  kind: FileKind;
  fileId: string;
  filename: string;
};

const FILE_KINDS = new Set<FileKind>(Object.keys(KIND_POLICY) as FileKind[]);

/**
 * The presigned PUT is only ever signed for this key. A presigned URL stays usable
 * until it expires — including after finalize — so the bytes the browser writes and
 * the bytes we publish must never share a key, or a second PUT could replace a
 * validated object that `/f/{fileId}` serves as immutable. Version 2 starts with a
 * bucket-root `staging/` segment so one lifecycle rule can expire only pending data.
 */
export function buildStagingKey(input: { eventId: EventId; kind: FileKind; fileId: string; filename: string }): string {
  return `staging/evt_${input.eventId}/${input.kind}/${input.fileId}/${sanitizeFilename(input.filename)}`;
}

/** Parses the lifecycle-covered staging layout without accepting near-misses. */
export function parseStagingKey(key: string): ParsedStagingKey | null {
  const segments = key.split("/");
  if (segments.length !== 5 || segments[0] !== "staging") return null;
  const [eventSegment, kindSegment, fileId, filename] = segments.slice(1) as [string, string, string, string];

  if (!eventSegment.startsWith("evt_") || eventSegment.length === 4) return null;
  if (!FILE_KINDS.has(kindSegment as FileKind) || !fileId || !filename) return null;
  return {
    eventId: eventSegment.slice(4),
    kind: kindSegment as FileKind,
    fileId,
    filename,
  };
}

export type AssetObjectKeyState = "published" | "staging" | "invalid";

/** One classification owns the finalizer, readiness checks, and download gate. */
export function classifyAssetObjectKey(
  key: string,
  asset: { eventId: EventId; kind: FileKind; fileId: string; filename: string },
): AssetObjectKeyState {
  if (key === buildObjectKey(asset)) return "published";
  const parsed = parseStagingKey(key);
  if (
    !parsed
    || parsed.eventId !== asset.eventId
    || parsed.kind !== asset.kind
    || parsed.fileId !== asset.fileId
    || parsed.filename !== sanitizeFilename(asset.filename)
  ) return "invalid";
  return "staging";
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

// The admin arm carries the member's role and id because the decision below
// needs both: a reviewer is not an organizer with a smaller screen, and
// resolving their scope takes the user the assignment is written against.
export type FileRequester =
  | { kind: "admin"; role: MemberRole; userId: UserId }
  | { kind: "contact"; contactId: ContactId };

/**
 * Pure access decision. `linkedContactIds` is every contact the file is attached
 * to through a file request, a task upload, or a submission they participate in.
 * `reviewerScopedFile` is the same question for a reviewer: organizers own every
 * file in their event, but a reviewer reads only what a round routes to them, so
 * for that role it is the whole decision and it is resolved by the caller.
 */
export function decideFileAccess(input: {
  uploadedByContactId: string | null;
  linkedContactIds: readonly string[];
  reviewerScopedFile?: boolean;
  requester: FileRequester;
}): boolean {
  if (input.requester.kind === "admin") {
    return input.requester.role === "reviewer" ? input.reviewerScopedFile === true : true;
  }
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

function objectUrl(config: R2Config, key: string): URL {
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  return new URL(`https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}/${encoded}`);
}

function awsClient(config: R2Config): AwsClient {
  return new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: "s3",
    region: "auto",
  });
}

async function presign(key: string, method: "PUT" | "GET", expiresInSeconds: number, headers?: Record<string, string>): Promise<string> {
  const config = r2Config();
  const url = objectUrl(config, key);
  url.searchParams.set("X-Amz-Expires", String(expiresInSeconds));
  const signed = await awsClient(config).sign(url.toString(), {
    method,
    ...(headers ? { headers } : {}),
    aws: { signQuery: true },
  });
  return signed.url;
}

/**
 * Server-side copy — the bytes stay inside R2, so a 100 MB slide costs the Worker
 * nothing. S3 can report failure inside a 200 body, so the body is checked too.
 */
async function copyObject(sourceKey: string, destinationKey: string): Promise<void> {
  const config = r2Config();
  const source = `/${config.bucket}/${sourceKey.split("/").map(encodeURIComponent).join("/")}`;
  const response = await awsClient(config).fetch(objectUrl(config, destinationKey).toString(), {
    method: "PUT",
    headers: { "x-amz-copy-source": source },
    // Finalize runs on the request path; a stalled copy must not hold it open.
    signal: AbortSignal.timeout(COPY_TIMEOUT_MS),
  });
  const body = await response.text();
  if (!response.ok || body.includes("<Error")) {
    throw new AppError("INTERNAL", `Could not publish the uploaded file (${response.status})`);
  }
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
  /** Caller-settable headers that are part of the signature. */
  requiredHeaders: Record<string, string>;
}

/**
 * file_assets has no status column, so a row means "presigned", not "ready" — a
 * pending row is the one whose r2_key is still the staging key. Callers must only
 * persist a fileId into an owning column after finalizeUpload returns ready;
 * cleanupOrphanUploads sweeps whatever never got there.
 *
 * size_bytes holds the client's declared size until finalize overwrites it with the
 * size that actually landed. That declared value is what presign checked the policy
 * against, which is how finalize enforces a per-file-request limit it cannot see.
 */
export async function createUpload(input: CreateUploadInput): Promise<CreateUploadResult> {
  assertUploadAllowed(input);
  const fileId = fileIdSchema.parse(crypto.randomUUID());
  const filename = sanitizeFilename(input.filename);
  const stagingKey = buildStagingKey({ eventId: input.eventId, kind: input.kind, fileId, filename });
  await db.insert(fileAssets).values({
    id: fileId,
    eventId: input.eventId,
    kind: input.kind,
    r2Key: stagingKey,
    filename,
    mime: input.mime,
    sizeBytes: input.sizeBytes,
    ...(input.uploadedByUserId ? { uploadedByUserId: input.uploadedByUserId } : {}),
    ...(input.uploadedByContactId ? { uploadedByContactId: input.uploadedByContactId } : {}),
  });
  // These are handed to the client and sent on the PUT, but they are NOT bound
  // into the signature: aws4fetch lists `content-type` and `content-length` in
  // UNSIGNABLE_HEADERS and drops them unless `allHeaders` is set, which
  // `presign` does not pass — so `X-Amz-SignedHeaders` is only `host`. A URL
  // issued for a 1-byte headshot will therefore accept any body R2 takes in a
  // single PUT.
  //
  // What actually enforces the limit is the post-copy inspection below:
  // `finalizeUpload` copies to the published key, then `inspectPublished` ->
  // `rejectionForSize` re-checks the bytes that really landed against both the
  // kind ceiling and `authorizedBytes`, and deletes both objects and the row.
  // Nothing oversize is ever published or served, and the unsigned content type
  // never reaches a response header — `publicFileHeaders` uses the DB `mime`.
  // The residual cost is unreclaimed `staging/` bytes until the daily sweep;
  // `/api/uploads/presign` bounds that with a per-uploader rate limit.
  //
  // Passing `aws: { allHeaders: true }` in `presign` would bind them properly,
  // but it makes every upload fail if the browser's own Content-Length or
  // Content-Type differs from the signed value by a byte or a charset suffix,
  // and that cannot be verified against a mocked R2. It needs a live-bucket
  // check before it ships.
  const signedHeaders = { "content-type": input.mime, "content-length": String(input.sizeBytes) };
  const uploadUrl = await presign(stagingKey, "PUT", PRESIGN_PUT_SECONDS, signedHeaders);
  return {
    fileId,
    uploadUrl,
    // Content-Length remains signed above, but a browser derives it from the
    // File body and forbids JavaScript from setting it explicitly.
    requiredHeaders: { "Content-Type": input.mime },
  };
}

export type FinalizeResult = { status: "ready" } | { status: "rejected"; reason: string };

async function purge(key: string, fileId: FileId): Promise<void> {
  // The object delete is best effort — a failure here must not turn a rejection
  // into a thrown error, because the caller is told to drop this fileId either way.
  await filesBucket().delete(key).catch(() => undefined);
  // Leaving the row behind would let a caller that already holds the fileId point
  // at nothing.
  await db.delete(fileAssets).where(eq(fileAssets.id, fileId));
}

/**
 * Size verdict for the bytes that actually landed. `authorizedBytes` is the size
 * presign approved against the effective policy — for kind=upload that policy came
 * from the owning file_requests row, which finalize can no longer see, so honouring
 * the authorized size is what keeps an organizer's per-request limit real.
 */
export function rejectionForSize(input: { kind: FileKind; actualBytes: number; authorizedBytes: number }): string | null {
  const ceiling = KIND_POLICY[input.kind].maxSizeMb * MB;
  if (input.actualBytes > ceiling) {
    return `${input.kind} files are limited to ${Math.floor(ceiling / MB)} MB`;
  }
  if (input.actualBytes > input.authorizedBytes) {
    return "the upload is larger than the size it was authorized for";
  }
  return null;
}

/**
 * Authoritative post-upload check: presign constrains the claim, this constrains
 * the bytes. The staged object is copied to its published key *before* it is
 * inspected, because the presigned PUT stays usable until it expires and can only
 * ever write the staging key — so what we validate is exactly what we serve.
 */
export async function finalizeUpload(fileId: string): Promise<FinalizeResult> {
  const id = fileIdSchema.parse(fileId);
  const [asset] = await db
    .select({
      eventId: fileAssets.eventId,
      kind: fileAssets.kind,
      mime: fileAssets.mime,
      filename: fileAssets.filename,
      r2Key: fileAssets.r2Key,
      sizeBytes: fileAssets.sizeBytes,
    })
    .from(fileAssets)
    .where(eq(fileAssets.id, id))
    .limit(1);
  if (!asset) throw new AppError("NOT_FOUND", "Upload not found");

  const eventId = asset.eventId as EventId;
  const publishedKey = buildObjectKey({ eventId, kind: asset.kind, fileId: id, filename: asset.filename });
  const keyState = classifyAssetObjectKey(asset.r2Key, {
    eventId,
    kind: asset.kind,
    fileId: id,
    filename: asset.filename,
  });
  // Already published: the row's key is the immutable one, so finalize is a no-op.
  if (keyState === "published") return { status: "ready" };
  if (keyState === "invalid") {
    throw new AppError("INTERNAL", "Upload storage key does not match its file record");
  }

  const stagingKey = asset.r2Key;
  const bucket = filesBucket();
  if (!(await bucket.head(stagingKey))) {
    // A concurrent finalize publishes and then removes the staging object, so a
    // missing one only means "never uploaded" while the row still points at it.
    if (await isPublished(id, publishedKey)) return { status: "ready" };
    await purge(stagingKey, id);
    return { status: "rejected", reason: "the upload never reached storage" };
  }
  try {
    await copyObject(stagingKey, publishedKey);
  } catch (error) {
    if (await isPublished(id, publishedKey)) return { status: "ready" };
    throw error;
  }

  const reason = await inspectPublished(publishedKey, { kind: asset.kind, mime: asset.mime, authorizedBytes: asset.sizeBytes });
  if (reason) {
    await bucket.delete(publishedKey).catch(() => undefined);
    await purge(stagingKey, id);
    return { status: "rejected", reason };
  }

  const head = await bucket.head(publishedKey);
  await db.update(fileAssets).set({ r2Key: publishedKey, sizeBytes: head?.size ?? asset.sizeBytes }).where(eq(fileAssets.id, id));
  // Best effort: a leftover staging object is storage debt, not a correctness bug.
  await bucket.delete(stagingKey).catch(() => undefined);
  return { status: "ready" };
}

/** Re-reads the row: the published key is the marker that finalize already ran. */
async function isPublished(fileId: FileId, publishedKey: string): Promise<boolean> {
  const [row] = await db.select({ r2Key: fileAssets.r2Key }).from(fileAssets).where(eq(fileAssets.id, fileId)).limit(1);
  return row?.r2Key === publishedKey;
}

/** Returns a rejection reason, or null when the published object is acceptable. */
async function inspectPublished(
  key: string,
  asset: { kind: FileKind; mime: string; authorizedBytes: number },
): Promise<string | null> {
  const bucket = filesBucket();
  const head = await bucket.head(key);
  if (!head) return "the upload never reached storage";

  const sizeReason = rejectionForSize({ kind: asset.kind, actualBytes: head.size, authorizedBytes: asset.authorizedBytes });
  if (sizeReason) return sizeReason;

  if (IMAGE_MIMES.includes(asset.mime.toLowerCase() as (typeof IMAGE_MIMES)[number])) {
    const ranged = await bucket.get(key, { range: { offset: 0, length: 16 } });
    const bytes = ranged ? new Uint8Array(await ranged.arrayBuffer()) : new Uint8Array();
    if (!sniffMatchesMime(asset.mime, bytes)) return "the file contents do not match the declared type";
  }
  return null;
}

export type FileDescriptor = {
  fileId: FileId;
  eventId: EventId;
  kind: FileKind;
  mime: string;
  filename: string;
  sizeBytes: number;
  uploadedByUserId: string | null;
  uploadedByContactId: string | null;
  /** False while the row still points at its staging key, i.e. before finalize. */
  published: boolean;
};

/** Row-level lookup for the routes, which must authorize against the file's own event. */
export async function describeFile(fileId: string): Promise<FileDescriptor | null> {
  const id = fileIdSchema.parse(fileId);
  const [asset] = await db
    .select({
      eventId: fileAssets.eventId,
      kind: fileAssets.kind,
      mime: fileAssets.mime,
      filename: fileAssets.filename,
      sizeBytes: fileAssets.sizeBytes,
      r2Key: fileAssets.r2Key,
      uploadedByUserId: fileAssets.uploadedByUserId,
      uploadedByContactId: fileAssets.uploadedByContactId,
    })
    .from(fileAssets)
    .where(eq(fileAssets.id, id))
    .limit(1);
  if (!asset) return null;
  const eventId = asset.eventId as EventId;
  return {
    fileId: id,
    eventId,
    kind: asset.kind,
    mime: asset.mime,
    filename: asset.filename,
    sizeBytes: asset.sizeBytes,
    uploadedByUserId: asset.uploadedByUserId,
    uploadedByContactId: asset.uploadedByContactId,
    published: classifyAssetObjectKey(asset.r2Key, {
      eventId,
      kind: asset.kind,
      fileId: id,
      filename: asset.filename,
    }) === "published",
  };
}

/**
 * Headers for `/f/{fileId}`. Content-Type is always the value stored on the row —
 * never R2 object metadata, which an uploader controls. Contents are immutable
 * because replacing a file mints a new fileId, so the year-long cache is safe.
 */
export function publicFileHeaders(file: { mime: string; kind: FileKind; sizeBytes?: number }): Headers {
  const headers = new Headers({
    "content-type": file.mime,
    "cache-control": "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
  });
  // No public kind is non-image today; the branch keeps a future one safe by default.
  if (!IMAGE_MIMES.includes(file.mime.toLowerCase() as (typeof IMAGE_MIMES)[number])) {
    headers.set("content-disposition", "attachment");
  }
  if (typeof file.sizeBytes === "number" && file.sizeBytes > 0) headers.set("content-length", String(file.sizeBytes));
  return headers;
}

/**
 * Streams a public file straight off the binding. Returns null for anything the
 * route must 404: unknown id, unfinalized row, private kind (those serve only
 * through getDownloadUrl's presigned GET), or a missing object.
 */
export async function readPublicFile(fileId: string): Promise<{ body: ReadableStream; headers: Headers } | null> {
  const file = await describeFile(fileId);
  if (!file || !file.published || !isPublicKind(file.kind)) return null;
  const key = buildObjectKey({ eventId: file.eventId, kind: file.kind, fileId: file.fileId, filename: file.filename });
  const object = await filesBucket().get(key);
  if (!object?.body) return null;
  return { body: object.body, headers: publicFileHeaders({ mime: file.mime, kind: file.kind, sizeBytes: object.size }) };
}

/**
 * Always scoped by (eventId, fileId, requester) together — a contact id from one
 * event must never unlock a file in another.
 */
export async function getDownloadUrl(eventId: EventId, fileId: string, requester: FileRequester): Promise<string> {
  const id = fileIdSchema.parse(fileId);
  const [asset] = await db
    .select({
      kind: fileAssets.kind,
      filename: fileAssets.filename,
      r2Key: fileAssets.r2Key,
      uploadedByContactId: fileAssets.uploadedByContactId,
    })
    .from(fileAssets)
    .where(sql`${fileAssets.id} = ${id} AND ${fileAssets.eventId} = ${eventId}`)
    .limit(1);
  if (!asset) throw new AppError("NOT_FOUND", "File not found");
  // A row still on its staging key never passed finalize, so its bytes were never
  // size-checked or sniffed. Handing out a URL for them would serve exactly what
  // the module promises never to serve.
  if (classifyAssetObjectKey(asset.r2Key, {
    eventId,
    kind: asset.kind,
    fileId: id,
    filename: asset.filename,
  }) !== "published") {
    throw new AppError("NOT_FOUND", "File is not ready yet");
  }

  const linkedContactIds = requester.kind === "contact" ? await linkedContacts(eventId, id) : [];
  const reviewerScopedFile = requester.kind === "admin" && requester.role === "reviewer"
    ? await reviewerScopesFile(eventId, id, requester.userId)
    : false;
  if (!decideFileAccess({ uploadedByContactId: asset.uploadedByContactId, linkedContactIds, reviewerScopedFile, requester })) {
    throw new AppError("FORBIDDEN", "You do not have access to this file");
  }
  return presign(asset.r2Key, "GET", DOWNLOAD_URL_SECONDS);
}

/**
 * A reviewer's file scope in one statement: the file answers a question on a
 * submission routed to this reviewer by a round they may already read. It is
 * deliberately no wider than the reviewer's own DTO —
 * `assertReviewerCanReadSubmissionIn` for the assignment and the window,
 * `blindAnswerPanel`'s kept file ids for an anonymized round — so a file id they
 * hold from a revoked assignment, a closed-then-reopened question or another
 * organizer surface does not outlive the screen that handed it to them.
 */
async function reviewerScopesFile(eventId: EventId, fileId: FileId, reviewerUserId: UserId): Promise<boolean> {
  const rows = await db.execute<{ ok: number }>(sql`
    SELECT 1 AS ok
    FROM submission_answers sa
      JOIN submissions s ON s.id = sa.submission_id AND s.event_id = sa.event_id
      JOIN review_assignments ra ON ra.submission_id = sa.submission_id AND ra.event_id = sa.event_id
        AND ra.reviewer_user_id = ${reviewerUserId} AND ra.status = 'assigned'
      JOIN evaluation_plans p ON p.id = ra.plan_id AND p.event_id = ra.event_id
    WHERE sa.event_id = ${eventId} AND sa.value->>'t' = 'file' AND sa.value->>'v' = ${fileId}
      -- reviewWindow().canRead: reading starts when the round opens and never
      -- stops again, so only a round still before its opens_at withholds it.
      AND (p.opens_at IS NULL OR p.opens_at <= now())
      -- An anonymized round shows only content-classified answers, so only those
      -- file ids were ever the reviewer's to hold. A locked field, and a snapshot
      -- compiled before the classification existed, both read as identity here
      -- exactly as they do in blindAnswerPanel.
      AND (NOT p.anonymize_authors OR EXISTS (
        SELECT 1 FROM form_versions fv
          CROSS JOIN LATERAL jsonb_array_elements(fv.snapshot->'sections') sec
          CROSS JOIN LATERAL jsonb_array_elements(sec->'fields') f
        WHERE fv.event_id = s.event_id AND fv.form_id = s.form_id AND fv.version = s.form_version
          AND f->>'id' = sa.field_id::text AND f->>'reviewVisibility' = 'content'
          AND COALESCE((f->>'locked')::boolean, false) = false
      ))
    LIMIT 1
  `);
  return (rows.rows ?? []).length > 0;
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
 * Every owning reference that makes a file_assets row live — the four owning
 * columns plus the two answer stores that hold a `{t:'file'}` value (a CFP answer
 * row and a portal form response's answers object), plus a completed M52
 * export's own `file_export_jobs.result_file_id`. Exported so the runtime sweep
 * and its PGlite regression test cannot drift apart: a missed reference here
 * deletes a file that is still in use.
 *
 * The export-job clause matters even though `result_file_id` has an
 * `ON DELETE SET NULL` FK to this table: without it, this general sweep (age-gated
 * on `file_assets.created_at`, with no notion of the job's own `expires_at`) would
 * silently null out a live, not-yet-expired export's `result_file_id` and delete
 * its ZIP the moment the row turns 24h old — expiry-based cleanup for export ZIPs
 * belongs to `pruneExpiredFileExportsIn` alone (`deliverables/server/export.ts`),
 * which respects `expires_at` and removes the job row along with it.
 */
export const ORPHAN_PREDICATE_SQL = `
  NOT EXISTS (SELECT 1 FROM contacts c WHERE c.headshot_file_id = fa.id)
  AND NOT EXISTS (SELECT 1 FROM events e WHERE e.logo_file_id = fa.id OR e.background_file_id = fa.id)
  AND NOT EXISTS (SELECT 1 FROM file_uploads fu WHERE fu.file_asset_id = fa.id)
  AND NOT EXISTS (
    SELECT 1 FROM submission_answers sa
    WHERE sa.value->>'t' = 'file' AND sa.value->>'v' = fa.id::text
  )
  AND NOT EXISTS (
    SELECT 1 FROM form_responses fr
    CROSS JOIN LATERAL jsonb_each(
      CASE WHEN jsonb_typeof(fr.answers) = 'object' THEN fr.answers ELSE '{}'::jsonb END
    ) AS answer(key, value)
    WHERE answer.value->>'t' = 'file' AND answer.value->>'v' = fa.id::text
  )
  AND NOT EXISTS (SELECT 1 FROM file_export_jobs fej WHERE fej.result_file_id = fa.id)
`;

/**
 * Best-effort daily sweep, wired to M08's cleanup cron slot (via `cleanupOrphans`
 * below). One pass is the entire budget — no retry or backfill machinery.
 */
export async function cleanupOrphanUploads(olderThanHours = 24): Promise<{ deleted: number }> {
  const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
  const deleted = await db.execute<{ r2_key: string }>(sql`
    DELETE FROM file_assets fa
    WHERE fa.created_at < ${cutoff} AND ${sql.raw(ORPHAN_PREDICATE_SQL)}
    RETURNING fa.r2_key
  `);
  const keys = (deleted.rows ?? []).map((row) => row.r2_key);
  if (keys.length > 0) {
    // The row that held the key is already gone, so a failed delete can never be
    // retried from the database — log the keys or the object is silently stranded.
    const { stranded } = await deleteObjects(keys);
    reportStrandedObjects(stranded, { feature: "uploads", requestId: "cron", code: "R2_STRANDED_ORPHAN_ROWS" });
  }
  return { deleted: keys.length };
}

// ---------------------------------------------------------------------------
// P3-OPS — R2 orphan-staging-object sweep. cleanupOrphanUploads (above) can
// only ever find garbage by walking file_assets rows, so it is blind to a
// staging object whose row is already gone — the finalize path deletes the
// stray staging object best-effort (see `finalizeUpload`) and a failed delete
// there is a genuine, permanent orphan with no row left to retry from. This
// sweep finds those the other way around: list what actually exists in R2 via
// the S3 API (the same aws4fetch client `presign`/`copyObject` already use —
// this file stays the only module touching R2 or the S3 wire format), then
// keep whatever staging-prefixed key is (a) older than the TTL and (b) not
// the current r2_key of any file_assets row.
// ---------------------------------------------------------------------------

const LIST_TIMEOUT_MS = 20_000;
/** Bounds one cron tick to ~5,000 listed objects — a budget, not a promise of completeness. */
const ORPHAN_SWEEP_MAX_PAGES = 5;

export type ListedObject = { key: string; lastModified: Date };
export type ListObjectsPage = { objects: ListedObject[]; nextToken: string | null };

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Minimal ListObjectsV2 XML reader: no XML parser is available in the Workers
 * runtime and this repo does not add one for four fields. Exported so its
 * correctness can be pinned directly against a captured S3/R2 response body,
 * independent of network access.
 */
export function parseListObjectsXml(xml: string): ListObjectsPage {
  const objects: ListedObject[] = [];
  const contentsPattern = /<Contents>([\s\S]*?)<\/Contents>/g;
  let match: RegExpExecArray | null;
  while ((match = contentsPattern.exec(xml)) !== null) {
    const block = match[1] ?? "";
    const key = /<Key>([\s\S]*?)<\/Key>/.exec(block)?.[1];
    const lastModified = /<LastModified>([\s\S]*?)<\/LastModified>/.exec(block)?.[1];
    if (key && lastModified) objects.push({ key: decodeXmlEntities(key), lastModified: new Date(lastModified) });
  }
  const nextToken = /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1];
  return { objects, nextToken: nextToken ? decodeXmlEntities(nextToken) : null };
}

async function listObjectsPage(continuationToken?: string, prefix?: string): Promise<ListObjectsPage> {
  const config = r2Config();
  const url = new URL(`https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}`);
  url.searchParams.set("list-type", "2");
  url.searchParams.set("max-keys", "1000");
  if (continuationToken) url.searchParams.set("continuation-token", continuationToken);
  if (prefix) url.searchParams.set("prefix", prefix);
  const response = await awsClient(config).fetch(url.toString(), {
    method: "GET",
    signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
  });
  if (!response.ok) throw new AppError("INTERNAL", `Could not list storage objects (${response.status})`);
  return parseListObjectsXml(await response.text());
}

async function deleteObjectViaS3(key: string): Promise<boolean> {
  const config = r2Config();
  // A 404 here means the object is already gone, which is the outcome this
  // delete wants — not a failure to report or retry.
  const response = await awsClient(config).fetch(objectUrl(config, key).toString(), {
    method: "DELETE",
    signal: AbortSignal.timeout(COPY_TIMEOUT_MS),
  });
  return response.ok || response.status === 404;
}

function hasR2Credentials(): boolean {
  const env = getEnv();
  return Boolean(env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET_NAME);
}

export type OrphanSweepStats = JobStats & { deletedRows: number; deletedStagingObjects: number; scannedObjects: number; skippedNoCredentials: number };

/**
 * The staging-object half of the sweep, dependency-injectable so the
 * candidate/ownership logic can run against PGlite without live R2 or S3
 * network access. `hasCredentials`/`listPage`/`deleteKey` default to the real
 * R2-backed implementations; `cleanupOrphans` below is what the cron calls.
 */
export async function sweepOrphanStagingObjectsIn(
  dbOrTx: DbOrTx,
  olderThanHours: number,
  options?: {
    hasCredentials?: () => boolean;
    listPage?: (continuationToken?: string) => Promise<ListObjectsPage>;
    deleteKey?: (key: string) => Promise<boolean>;
  },
): Promise<{ deleted: number; scanned: number; skipped: boolean }> {
  const hasCredentials = options?.hasCredentials ?? hasR2Credentials;
  if (!hasCredentials()) {
    // Degrade gracefully: a local/dev environment with no S3 credentials must
    // not fail the cron tick over a sweep it cannot perform.
    log({ level: "info", msg: "r2.orphan_sweep.skipped_no_credentials", requestId: "cron", feature: "uploads" });
    return { deleted: 0, scanned: 0, skipped: true };
  }
  const listPage = options?.listPage ?? ((continuationToken?: string) => listObjectsPage(continuationToken, "staging/"));
  const deleteKey = options?.deleteKey ?? deleteObjectViaS3;

  const cutoffMs = Date.now() - olderThanHours * 60 * 60 * 1000;
  const candidates: string[] = [];
  let scanned = 0;
  let token: string | undefined;
  let pages = 0;
  do {
    const page = await listPage(token);
    pages += 1;
    for (const object of page.objects) {
      scanned += 1;
      if (parseStagingKey(object.key) && object.lastModified.getTime() < cutoffMs) candidates.push(object.key);
    }
    token = page.nextToken ?? undefined;
  } while (token && pages < ORPHAN_SWEEP_MAX_PAGES);

  if (candidates.length === 0) return { deleted: 0, scanned, skipped: false };

  // A staging key still current on some row is mid-upload, not orphaned — it
  // is cleanupOrphanUploads's job (age-gated on the row, not the object) to
  // ever reclaim it. Only a key no row points to at all belongs to this sweep.
  const owned = await dbOrTx.select({ r2Key: fileAssets.r2Key }).from(fileAssets).where(inArray(fileAssets.r2Key, candidates));
  const ownedKeys = new Set(owned.map((row) => row.r2Key));
  const orphanKeys = candidates.filter((key) => !ownedKeys.has(key));
  if (orphanKeys.length === 0) return { deleted: 0, scanned, skipped: false };

  const stranded = await failedDeleteKeys(orphanKeys, deleteKey);
  reportStrandedObjects(stranded, { feature: "uploads", requestId: "cron", code: "R2_STRANDED_STAGING_SWEEP" });
  return { deleted: orphanKeys.length - stranded.length, scanned, skipped: false };
}

/**
 * The cleanup cron's actual entry point: the DB-row sweep (deletes an
 * unreferenced file_assets row and its object) plus the R2-listing sweep
 * (deletes a dangling staging object no row points to). The two cover
 * different failure shapes of the same debt and share nothing but the
 * bucket, so a credentials gap in the second never blocks the first.
 */
export async function cleanupOrphans(olderThanHours = 24): Promise<OrphanSweepStats> {
  const rows = await cleanupOrphanUploads(olderThanHours);
  const staging = await sweepOrphanStagingObjectsIn(db, olderThanHours);
  return {
    deletedRows: rows.deleted,
    deletedStagingObjects: staging.deleted,
    scannedObjects: staging.scanned,
    skippedNoCredentials: staging.skipped ? 1 : 0,
  };
}

// ---------------------------------------------------------------------------
// M52 — latest-file ZIP export. The one deliberate exception to "file bytes
// never pass through the Worker": there is no R2-side operation that
// combines several objects into one archive, so building the ZIP has to read
// each source object's bytes into the Worker and write the result back out.
// Confined here, behind two functions, and only ever called by
// `deliverables/server/export.ts`'s job processor — never from a request
// handler on the upload path.
// ---------------------------------------------------------------------------

/** Every byte of an already-published object. Null if it does not exist. */
export async function getObjectBytes(key: string): Promise<Uint8Array | null> {
  const object = await filesBucket().get(key);
  if (!object?.body) return null;
  return new Uint8Array(await object.arrayBuffer());
}

/**
 * Best-effort bulk delete, independent per key — the same discipline
 * `cleanupOrphanUploads` already uses for its own object deletes. Callers
 * that already dropped the owning row cannot retry a failed delete from
 * anywhere, so a stranded key comes back to be logged rather than thrown.
 */
export async function deleteObjects(keys: readonly string[]): Promise<{ stranded: string[] }> {
  if (keys.length === 0) return { stranded: [] };
  const bucket = filesBucket();
  return { stranded: await failedDeleteKeys(keys, (key) => bucket.delete(key)) };
}

/**
 * Which sweep stranded the object. This is the only field an operator can
 * filter the persisted record on, so the four sites stay distinguishable —
 * a failed nightly cleanup and a failed right-to-erasure purge call for very
 * different responses.
 */
export type StrandedObjectSource =
  | "R2_STRANDED_ORPHAN_ROWS"
  | "R2_STRANDED_STAGING_SWEEP"
  | "R2_STRANDED_CONTACT_ERASURE"
  | "R2_STRANDED_EXPORT_PRUNE";

/** Keys named in full before the message summarizes the rest. */
const STRANDED_KEYS_LOGGED = 20;

/**
 * A stranded key's owning `file_assets` row is already gone, so nothing can
 * ever retry the delete: the object is unreachable and billed forever, and no
 * sweep can find it (the orphan sweep only lists the `staging/` prefix).
 *
 * That is an operator's problem, not a debug note. `log({ level: "warn" })`
 * left it out of `operational_error_buckets` and therefore out of the
 * `errors.recentCount` alert in docs/runbooks/alerting.md, so every one of
 * these went unnoticed.
 */
export function reportStrandedObjects(
  keys: readonly string[],
  context: { feature: string; requestId: string; code: StrandedObjectSource; eventId?: EventId },
): void {
  if (keys.length === 0) return;
  // `operational_error_buckets` persists only feature, code, and a fingerprint —
  // never the message — so `code` is the whole of what an operator can filter
  // on, and a routine cron hygiene failure must not read the same as a
  // right-to-erasure leak. The key list stays bounded: an unbounded join can
  // exceed a log entry's size limit and be dropped in full.
  const shown = keys.slice(0, STRANDED_KEYS_LOGGED);
  const suffix = keys.length > shown.length ? ` (+${keys.length - shown.length} more)` : "";
  captureError(
    new Error(`${keys.length} R2 object(s) were not deleted and can no longer be reached: ${shown.join(", ")}${suffix}`),
    context,
  );
}

/** Run independent deletes and retain every key whose deletion rejected or explicitly failed. */
async function failedDeleteKeys(
  keys: readonly string[],
  deleteKey: (key: string) => Promise<unknown>,
): Promise<string[]> {
  const results = await Promise.allSettled(keys.map((key) => deleteKey(key)));
  return keys.filter((_key, index) => {
    const result = results[index];
    return !result || result.status === "rejected" || result.value === false;
  });
}

// ---------------------------------------------------------------------------
// M47 — data lifecycle & GDPR. Right-to-erasure deletes a contact's owning
// rows (file_uploads, contacts.headshot_file_id going away with the row
// itself) immediately, inside its own transaction; the `file_assets` rows
// those owners pointed at are not touched there, because R2/network calls do
// not belong inside a WebSocket-pool transaction. This is the prompt-purge
// half, called right after that transaction commits: unlike
// `cleanupOrphanUploads`'s daily age-gated sweep (which would eventually
// reclaim the same rows, just not for up to `olderThanHours`), this is
// scoped to exactly the file ids the caller already knows just lost their
// last owner, so it carries no age cutoff and cannot race a concurrent
// in-flight upload elsewhere the way a broadened global sweep would.
// ---------------------------------------------------------------------------

/**
 * Deletes each candidate `file_assets` row (and its R2 object) only if it is
 * *actually* orphaned right now — re-checked with the same `ORPHAN_PREDICATE_SQL`
 * the daily sweep uses, so a file id that turned out to still be referenced
 * elsewhere (e.g. a slide also attached to another contact's submission) is
 * left alone rather than deleted out from under that other reference.
 */
export async function purgeOrphanedFileAssets(candidateIds: readonly string[]): Promise<{ deleted: number }> {
  const ids = [...new Set(candidateIds)].filter(Boolean);
  if (ids.length === 0) return { deleted: 0 };
  const deleted = await db.execute<{ r2_key: string }>(sql`
    DELETE FROM file_assets fa
    WHERE fa.id = ANY(${ids}::uuid[]) AND ${sql.raw(ORPHAN_PREDICATE_SQL)}
    RETURNING fa.r2_key
  `);
  const keys = (deleted.rows ?? []).map((row) => row.r2_key);
  if (keys.length === 0) return { deleted: 0 };
  const { stranded } = await deleteObjects(keys);
  reportStrandedObjects(stranded, { feature: "uploads", requestId: "gdpr", code: "R2_STRANDED_CONTACT_ERASURE" });
  return { deleted: keys.length };
}

/**
 * The stable object key (and eventual `file_assets.id`) a streamed export
 * publishes to — `buildObjectKey`'s own collision-safe scheme, keyed on a
 * fileId decided once at the export's first processing step and persisted
 * in the job row (`export_state.exportFileId`) so every later step, whether
 * it runs in this invocation or a fresh one, writes to the same object.
 */
export function buildExportZipKey(eventId: EventId, exportFileId: string): string {
  return buildObjectKey({ eventId, kind: "attachment", fileId: exportFileId, filename: `deliverables-export-${exportFileId}.zip` });
}

export type MultipartPart = { partNumber: number; etag: string };

/**
 * Begins an R2 multipart upload for a server-generated export ZIP. Each
 * part is written by a separate, bounded `uploadExportPart` call — possibly
 * from a later Worker invocation than this one — which is the whole reason
 * this streams through multipart rather than one `bucket.put()`: R2 (like
 * S3) requires every non-final part to be at least 5 MiB, so the caller
 * batches entries up to that floor per part rather than holding the whole
 * archive in memory at once.
 */
export async function beginExportMultipart(key: string): Promise<string> {
  const upload = await filesBucket().createMultipartUpload(key, { httpMetadata: { contentType: "application/zip" } });
  return upload.uploadId;
}

/**
 * Uploads one part of an in-progress multipart export. Reattaches to
 * `uploadId` via `resumeMultipartUpload` rather than holding the handle
 * `beginExportMultipart` returned — multipart upload state lives in R2, not
 * in this Worker's memory, so a step that runs in a fresh invocation (a
 * later poll, a cron tick) can resume exactly where a previous one left off.
 */
export async function uploadExportPart(key: string, uploadId: string, partNumber: number, bytes: Uint8Array): Promise<MultipartPart> {
  const upload = filesBucket().resumeMultipartUpload(key, uploadId);
  const part = await upload.uploadPart(partNumber, bytes);
  return { partNumber: part.partNumber, etag: part.etag };
}

/** Assembles every uploaded part into the final object. R2 validates part order/coverage itself; a mismatch throws. */
export async function completeExportMultipart(key: string, uploadId: string, parts: readonly MultipartPart[]): Promise<void> {
  const upload = filesBucket().resumeMultipartUpload(key, uploadId);
  await upload.complete(parts);
}

/**
 * Best-effort cleanup for an export that failed or expired mid-stream — an
 * incomplete multipart upload's parts are billed as ordinary storage until
 * completed or aborted, so a job that never finishes must not leave one
 * dangling. Never thrown for a caller to catch: the job is already being
 * marked `failed` (or its row deleted) either way, and an id R2 has already
 * forgotten (e.g. past its own 7-day incomplete-upload lifecycle) means
 * there is nothing left to abort.
 */
export async function abortExportMultipart(key: string, uploadId: string): Promise<void> {
  await filesBucket().resumeMultipartUpload(key, uploadId).abort().catch(() => undefined);
}

/**
 * Publishes the `file_assets` row for a completed streamed export
 * (kind='attachment', private) — there is no staging/finalize step because
 * nothing here is a client's unverified upload, and the bytes are already in
 * R2 via the just-completed multipart upload; this only records them.
 * `sizeBytes` is the caller's own running total (the streaming state's final
 * offset plus its tail), not a fresh R2 `head()` — the archive was built
 * byte-for-byte in this Worker, so its size was never in question.
 */
export async function publishExportAsset(input: { fileId: FileId; eventId: EventId; key: string; sizeBytes: number }): Promise<void> {
  await db.insert(fileAssets).values({
    id: input.fileId,
    eventId: input.eventId,
    kind: "attachment",
    r2Key: input.key,
    filename: `deliverables-export-${input.fileId}.zip`,
    mime: "application/zip",
    sizeBytes: input.sizeBytes,
  });
}
