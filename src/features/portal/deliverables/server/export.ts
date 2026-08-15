import { sql, type SQL } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import {
  fileExportJobDtoSchema,
  fileIdSchema,
  type ContactId,
  type EventId,
  type FileExportGroupBy,
  type FileExportJobDTO,
  type SubmissionId,
  type TaskId,
  type UserId,
} from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { log } from "@/shared/lib/log";
import {
  abortExportMultipart,
  beginExportMultipart,
  buildExportZipKey,
  completeExportMultipart,
  deleteObjects,
  getObjectBytes,
  publishExportAsset,
  reportStrandedObjects,
  uploadExportPart,
  type MultipartPart,
} from "@/shared/server/r2";
import { DELIVERABLE_BULK_LIMIT } from "../bulk-limit";
import { appendZipBatch, concat, finishZipStream, uniqueZipNamesFrom, type ZipNameDedupeState, type ZipStreamState } from "./zip";

/**
 * M52-ZIP — asynchronous, resumable latest-file ZIP export. Three phases:
 *
 *  1. `createFileExportJobIn` re-derives each selected slot's *current*
 *     latest file server-side (never trusting a client-supplied file id or
 *     "latest" claim — the module's own guardrail) and freezes that set into
 *     the job row, so the export never widens to a file uploaded after the
 *     request.
 *  2. `processFileExportJobIn` advances the job by exactly one *bounded*
 *     step — reads and ZIPs a batch of files sized to R2 multipart's ~5 MiB
 *     minimum part floor, uploads that as one part, and persists progress —
 *     then returns. It does not try to finish the job in one call.
 *  3. Repeated calls (the GET route's poll-driven fallback, a chained
 *     `waitUntil`, or the cleanup cron nudging a stalled job) each advance
 *     one more step until the last step completes the R2 multipart upload
 *     and publishes the result.
 *
 * Why: docs/evidence/m52-zip-cpu-measurement.md measured the previous
 * single-call, whole-archive-in-memory implementation against real workerd
 * (`wrangler dev`) at a realistic 25-file/2 MB-each export and found it
 * unsafe on both axes Workers actually enforces — CPU time (Free's 10 ms
 * budget, ~120x over) and isolate memory (the 128 MB ceiling on *every*
 * plan, not just Free — this implementation's own peak allocation pattern
 * put a 50 MB batch's footprint near 150 MB before this rewrite). Bounding
 * every step to one ~6 MiB batch bounds both: CPU cost per invocation no
 * longer grows with the number or size of files in the export (only with
 * one batch's worth), and peak memory per invocation is bounded to a small
 * constant multiple of the batch size, never the whole archive.
 *
 * None of the functions here are `withTx`-audited paths: each step issues
 * its own sequence of statements bookended by an atomic claim and a
 * terminal status write (or a persisted-progress write for a step that
 * isn't the last one) — a crash mid-step leaves the job `processing` with
 * its last-persisted progress intact rather than corrupting another job's
 * row or losing work already durably uploaded to R2.
 */

type Target = { taskId: TaskId; contactId: ContactId; submissionId: SubmissionId | null };

type JobRow = {
  id: string; status: string; group_by: FileExportGroupBy; entry_count: number; result_file_id: string | null;
  error: string | null; created_at: string; completed_at: string | null; expires_at: string | null;
};

function toDto(row: JobRow): FileExportJobDTO {
  return fileExportJobDtoSchema.parse({
    id: row.id,
    status: row.status,
    groupBy: row.group_by,
    entryCount: Number(row.entry_count),
    resultFileId: row.result_file_id,
    error: row.error,
    createdAt: new Date(row.created_at).toISOString(),
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
  });
}

const JOB_COLUMNS = sql`id, status, group_by, entry_count, result_file_id, error, created_at, completed_at, expires_at`;

/** Stalled jobs advanced by one step per cleanup tick — see `nudgeStalledFileExportsIn`. */
const NUDGE_BATCH_SIZE = 20;

function uuidArraySql(ids: readonly string[]): SQL {
  if (ids.length === 0) return sql`'{}'::uuid[]`;
  return sql`ARRAY[${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}]`;
}

/**
 * Re-derives the latest `file_uploads` row for every requested slot through
 * the same `task_assignments_v` boundary the upload and reminder paths
 * already trust, then freezes exactly those ids into the new job row.
 */
export async function createFileExportJobIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  actorUserId: UserId | null,
  targets: readonly Target[],
  groupBy: FileExportGroupBy,
): Promise<FileExportJobDTO> {
  if (targets.length === 0) throw new AppError("VALIDATION", "Select at least one deliverable to export");
  if (targets.length > DELIVERABLE_BULK_LIMIT) {
    throw new AppError("VALIDATION", `Export up to ${DELIVERABLE_BULK_LIMIT} deliverables at a time`);
  }

  const wantedSql = sql.join(
    targets.map((target) => sql`(${target.taskId}::uuid, ${target.contactId}::uuid, ${target.submissionId}::uuid)`),
    sql`, `,
  );
  const resolved = await dbOrTx.execute<{ file_upload_id: string }>(sql`
    WITH wanted(task_id, contact_id, submission_id) AS (VALUES ${wantedSql})
    SELECT DISTINCT u.id AS file_upload_id
    FROM task_assignments_v v
    JOIN portal_tasks t ON t.id = v.task_id AND t.event_id = v.event_id AND t.completion_mode = 'file_request'
    JOIN wanted w ON w.task_id = v.task_id AND w.contact_id = v.contact_id AND w.submission_id IS NOT DISTINCT FROM v.submission_id
    JOIN file_uploads u ON u.event_id = v.event_id AND u.file_request_id = t.file_request_id
      AND u.contact_id = v.contact_id AND u.submission_id IS NOT DISTINCT FROM v.submission_id AND u.is_latest
    WHERE v.event_id = ${eventId}
  `);
  const fileUploadIds = (resolved.rows ?? []).map((row) => row.file_upload_id);
  if (fileUploadIds.length === 0) throw new AppError("VALIDATION", "None of the selected deliverables have an uploaded file yet");

  const inserted = await dbOrTx.execute<JobRow>(sql`
    INSERT INTO file_export_jobs (event_id, requested_by_user_id, status, group_by, file_upload_ids, expires_at)
    VALUES (${eventId}, ${actorUserId}, 'pending', ${groupBy}::file_export_group_by, ${uuidArraySql(fileUploadIds)}, now() + interval '24 hours')
    RETURNING ${JOB_COLUMNS}
  `);
  const row = (inserted.rows ?? [])[0];
  if (!row) throw new AppError("INTERNAL", "The export job could not be created");
  return toDto(row);
}

export const createFileExportJob = (
  eventId: EventId, actorUserId: UserId | null, targets: readonly Target[], groupBy: FileExportGroupBy,
) => createFileExportJobIn(db, eventId, actorUserId, targets, groupBy);

export async function getFileExportJobIn(dbOrTx: DbOrTx, eventId: EventId, jobId: string): Promise<FileExportJobDTO | null> {
  const result = await dbOrTx.execute<JobRow>(sql`SELECT ${JOB_COLUMNS} FROM file_export_jobs WHERE id = ${jobId} AND event_id = ${eventId}`);
  const row = (result.rows ?? [])[0];
  return row ? toDto(row) : null;
}

export const getFileExportJob = (eventId: EventId, jobId: string) => getFileExportJobIn(db, eventId, jobId);

// ---------------------------------------------------------------------------
// Resumable progress, persisted in `file_export_jobs.export_state` (jsonb).
// ---------------------------------------------------------------------------

type ExportState = {
  /** Index into the job's frozen `file_upload_ids`, of the next file this export hasn't yet read. */
  nextIndex: number;
  /** Decided once, on the first step; stable for the rest of the job's life. */
  exportFileId: string | null;
  uploadId: string | null;
  /** Next R2 multipart part number to write (parts are 1-indexed). */
  partNumber: number;
  /** Running ZIP stream state, minus the entry bytes themselves — see `ZipStreamState`. */
  offset: number;
  centralB64: string;
  count: number;
  timeMs: number | null;
  /** Cross-batch name de-duplication counts — see `uniqueZipNamesFrom`. */
  nameDedupe: ZipNameDedupeState;
  uploadedParts: MultipartPart[];
  /** A short lease: set while a step is actively running, cleared when it finishes, so a concurrent poller can't advance the same job at the same time — but a step that crashed mid-way doesn't wedge the job forever either. */
  claimedAt: string | null;
};

const EMPTY_STATE: ExportState = {
  nextIndex: 0, exportFileId: null, uploadId: null, partNumber: 0,
  offset: 0, centralB64: "", count: 0, timeMs: null, nameDedupe: {}, uploadedParts: [], claimedAt: null,
};

function parseExportState(raw: unknown): ExportState {
  if (!raw || typeof raw !== "object") return { ...EMPTY_STATE };
  const value = raw as Partial<ExportState>;
  return {
    nextIndex: typeof value.nextIndex === "number" ? value.nextIndex : EMPTY_STATE.nextIndex,
    exportFileId: typeof value.exportFileId === "string" ? value.exportFileId : EMPTY_STATE.exportFileId,
    uploadId: typeof value.uploadId === "string" ? value.uploadId : EMPTY_STATE.uploadId,
    partNumber: typeof value.partNumber === "number" ? value.partNumber : EMPTY_STATE.partNumber,
    offset: typeof value.offset === "number" ? value.offset : EMPTY_STATE.offset,
    centralB64: typeof value.centralB64 === "string" ? value.centralB64 : EMPTY_STATE.centralB64,
    count: typeof value.count === "number" ? value.count : EMPTY_STATE.count,
    timeMs: typeof value.timeMs === "number" ? value.timeMs : EMPTY_STATE.timeMs,
    nameDedupe: value.nameDedupe && typeof value.nameDedupe === "object" ? value.nameDedupe : {},
    uploadedParts: Array.isArray(value.uploadedParts) ? value.uploadedParts : [],
    claimedAt: typeof value.claimedAt === "string" ? value.claimedAt : EMPTY_STATE.claimedAt,
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  if (!value) return new Uint8Array(0);
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toZipStreamState(state: ExportState): ZipStreamState {
  return { offset: state.offset, central: base64ToBytes(state.centralB64), count: state.count, timeMs: state.timeMs ?? Date.now() };
}

/**
 * Atomically claims either a fresh `pending` job or the next step of a job
 * already `processing` — a 25-second lease (`claimedAt`) stands in for a
 * visibility timeout: a step that finishes normally clears it immediately
 * (so the next poll, often ~1.5s later, isn't blocked), while a step that
 * crashed mid-way leaves it stale and lets a later caller retry from the
 * same persisted progress once the lease expires. Null if the job is
 * already claimed, already terminal, or does not exist.
 */
async function claimStepIn(
  dbOrTx: DbOrTx, eventId: EventId, jobId: string,
): Promise<{ groupBy: FileExportGroupBy; fileUploadIds: string[]; state: ExportState; lease: string } | null> {
  const claimed = await dbOrTx.execute<{ group_by: FileExportGroupBy; file_upload_ids: string[] | null; export_state: unknown }>(sql`
    UPDATE file_export_jobs
    SET status = 'processing', updated_at = now(),
        export_state = coalesce(export_state, '{}'::jsonb) || jsonb_build_object('claimedAt', now())
    WHERE id = ${jobId} AND event_id = ${eventId}
      AND status IN ('pending', 'processing')
      AND coalesce((export_state->>'claimedAt')::timestamptz, 'epoch'::timestamptz) < now() - interval '25 seconds'
    RETURNING group_by, file_upload_ids, export_state
  `);
  const row = (claimed.rows ?? [])[0];
  if (!row) return null;
  const state = parseExportState(row.export_state);
  // `RETURNING` gives back the `claimedAt` this statement just wrote, which is
  // the token every later write in this step must present.
  if (!state.claimedAt) return null;
  return { groupBy: row.group_by, fileUploadIds: row.file_upload_ids ?? [], state, lease: state.claimedAt };
}

/**
 * The lease this call is holding, as taken by `claimStepIn`. Every write that
 * ends a step carries it, so a step that overran the 25-second lease and was
 * re-claimed by another worker cannot overwrite that worker's newer progress
 * on its way out — which would rewind `nextIndex` and orphan the multipart
 * parts the newer worker had already uploaded.
 */
function heldLeaseSql(lease: string): SQL {
  return sql`(export_state->>'claimedAt')::timestamptz = ${lease}::timestamptz`;
}

/** True when the write landed; false means the lease was lost to another worker. */
async function stillHoldsLease(
  dbOrTx: DbOrTx, eventId: EventId, jobId: string, statement: SQL,
): Promise<boolean> {
  const result = await dbOrTx.execute<{ id: string }>(statement);
  const kept = (result.rows ?? []).length > 0;
  if (!kept) {
    log({
      level: "warn",
      msg: "file_export.lease_lost",
      requestId: `export:${jobId}`,
      feature: "deliverables",
      eventId,
    });
  }
  return kept;
}

async function failJobIn(
  dbOrTx: DbOrTx, eventId: EventId, jobId: string, lease: string, message: string,
): Promise<void> {
  // Without the lease this could mark `failed` a job another worker has since
  // re-claimed and completed.
  await stillHoldsLease(dbOrTx, eventId, jobId, sql`
    UPDATE file_export_jobs SET status = 'failed', error = ${message.slice(0, 1000)}, updated_at = now(), completed_at = now()
    WHERE id = ${jobId} AND event_id = ${eventId} AND ${heldLeaseSql(lease)}
    RETURNING id
  `);
}

/** Persists progress after a non-final step; clears the lease so the next poll can proceed immediately. */
async function persistStepIn(
  dbOrTx: DbOrTx, eventId: EventId, jobId: string, lease: string, state: ExportState,
): Promise<void> {
  const toStore = { ...state, claimedAt: null };
  await stillHoldsLease(dbOrTx, eventId, jobId, sql`
    UPDATE file_export_jobs SET status = 'processing', updated_at = now(), export_state = ${JSON.stringify(toStore)}::jsonb
    WHERE id = ${jobId} AND event_id = ${eventId} AND ${heldLeaseSql(lease)}
    RETURNING id
  `);
}

type ExportFileRow = { file_upload_id: string; r2_key: string; filename: string; size_bytes: number; group_label: string | null };

function groupLabelSql(groupBy: FileExportGroupBy): SQL {
  if (groupBy === "session") return sql`s.title`;
  if (groupBy === "speaker") return sql`coalesce(nullif(btrim(c.first_name || ' ' || c.last_name), ''), c.email)`;
  return sql`NULL::text`;
}

/** Each non-final R2 multipart part must clear R2/S3's 5 MiB floor; this adds a safety margin so a batch is never accidentally right at the edge. */
export const EXPORT_PART_TARGET_BYTES = 6 * 1024 * 1024;

/**
 * Pure batch planner, extracted so its boundary behavior (stop once the byte
 * target is cleared; never stop early just because one row's file vanished;
 * always terminate) is unit-testable without a database or R2. Walks
 * `remainingIds` — the job's own frozen order, already sliced to what's left
 * — accumulating resolved rows until `targetBytes` is met or the ids run
 * out. `consumed` counts *positions* consulted, not rows resolved, so a
 * caller's `nextIndex` always advances past a gap (an id whose row no
 * longer resolves) instead of retrying it forever.
 */
export function planExportBatch<T extends { sizeBytes: number }>(
  remainingIds: readonly string[],
  rowsById: ReadonlyMap<string, T>,
  targetBytes: number,
): { batch: T[]; consumed: number } {
  const batch: T[] = [];
  let batchBytes = 0;
  let consumed = 0;
  for (const id of remainingIds) {
    consumed += 1;
    const row = rowsById.get(id);
    if (row) {
      batch.push(row);
      batchBytes += row.sizeBytes;
    }
    if (batchBytes >= targetBytes) break;
  }
  return { batch, consumed };
}

/**
 * Advances a job by exactly one bounded step. Never throws for a caller to
 * catch — every failure path, including one this function did not
 * anticipate, lands the job in `failed` with a message (and best-effort
 * aborts any in-flight R2 multipart upload) rather than leaving it stranded
 * in `processing`.
 */
export async function processFileExportJobIn(dbOrTx: DbOrTx, eventId: EventId, jobId: string): Promise<void> {
  const claim = await claimStepIn(dbOrTx, eventId, jobId);
  if (!claim) return;
  const { groupBy, fileUploadIds, state, lease } = claim;

  // Tracked outside the try block (and updated the instant each is known,
  // not only on success) so the catch handler can abort whatever multipart
  // upload this call itself started, even when the failure happens later in
  // the very same step — otherwise a freshly created uploadId that never
  // made it into a persisted state would leak as an orphaned R2 upload.
  let currentExportFileId: string | null = state.exportFileId;
  let currentUploadId: string | null = state.uploadId;

  try {
    if (fileUploadIds.length === 0) throw new AppError("VALIDATION", "This export has no files to include");

    const exportFileId = state.exportFileId ?? crypto.randomUUID();
    currentExportFileId = exportFileId;
    const key = buildExportZipKey(eventId, exportFileId);
    const uploadId = state.uploadId ?? (await beginExportMultipart(key));
    currentUploadId = uploadId;

    const remainingIds = fileUploadIds.slice(state.nextIndex);
    if (remainingIds.length === 0) {
      // Every file was already accounted for by an earlier step; a job
      // reaching this state should already be terminal. Guard against a
      // stray re-poll rather than looping forever — the catch block below
      // aborts the multipart upload since `currentUploadId` is already set.
      throw new AppError("INTERNAL", "Export has no remaining files to process");
    }

    // Re-scoped to `eventId` again here, on top of the scoping already done
    // when the ids were resolved at creation — an export job re-checks
    // authorization at the point it actually touches file bytes, not only
    // when it was queued.
    const rows = await dbOrTx.execute<ExportFileRow>(sql`
      SELECT u.id AS file_upload_id, fa.r2_key, fa.filename, fa.size_bytes, ${groupLabelSql(groupBy)} AS group_label
      FROM file_uploads u
      JOIN file_assets fa ON fa.id = u.file_asset_id AND fa.event_id = u.event_id
      JOIN contacts c ON c.id = u.contact_id AND c.event_id = u.event_id
      LEFT JOIN submissions s ON s.id = u.submission_id AND s.event_id = u.event_id
      WHERE u.event_id = ${eventId} AND u.id = ANY(${uuidArraySql(remainingIds)})
    `);
    // `sizeBytes` mirrors `size_bytes` for `planExportBatch`'s generic bound
    // — kept as a plain `number` rather than the SQL driver's possibly-string
    // numeric so the byte-target comparison inside it is never a string
    // compare in disguise (should not happen; the driver returns bigint-typed
    // columns as JS numbers here, but `Number(...)` makes that an invariant,
    // not an assumption).
    const byId = new Map((rows.rows ?? []).map((row) => [row.file_upload_id, { ...row, sizeBytes: Number(row.size_bytes) }]));
    const { batch, consumed } = planExportBatch(remainingIds, byId, EXPORT_PART_TARGET_BYTES);
    const isLast = state.nextIndex + consumed >= fileUploadIds.length;

    const { names, seen: nextNameDedupe } = uniqueZipNamesFrom(
      state.nameDedupe, batch.map((row) => ({ group: row.group_label, filename: row.filename })),
    );
    const entries: { name: string; data: Uint8Array }[] = [];
    for (const [index, row] of batch.entries()) {
      const bytes = await getObjectBytes(row.r2_key);
      // A row whose object went missing is skipped rather than failing the
      // whole export for every other file in the batch.
      if (bytes) entries.push({ name: names[index] ?? row.filename, data: bytes });
    }

    const zipState = toZipStreamState(state);
    const appended = appendZipBatch(zipState, entries);

    if (isLast) {
      if (appended.state.count === 0) {
        // The catch block below aborts the multipart upload.
        throw new AppError("INTERNAL", "No file bytes could be read for this export");
      }
      const tail = finishZipStream(appended.state);
      const finalBytes = concat([appended.bytes, tail]);
      const partNumber = state.partNumber + 1;
      const uploadedPart = await uploadExportPart(key, uploadId, partNumber, finalBytes);
      await completeExportMultipart(key, uploadId, [...state.uploadedParts, uploadedPart]);
      await publishExportAsset({ fileId: fileIdSchema.parse(exportFileId), eventId, key, sizeBytes: appended.state.offset + tail.length });
      await dbOrTx.execute(sql`
        UPDATE file_export_jobs
        SET status = 'completed', result_file_id = ${exportFileId}, entry_count = ${appended.state.count},
            updated_at = now(), completed_at = now(), export_state = export_state || jsonb_build_object('claimedAt', null)
        WHERE id = ${jobId} AND event_id = ${eventId} AND ${heldLeaseSql(lease)}
        RETURNING id
      `);
      return;
    }

    // Not the last batch: this part is guaranteed >= EXPORT_PART_TARGET_BYTES
    // of *input* by the loop above (so comfortably clears R2's 5 MiB floor
    // once ZIP headers are added), unless every row in it vanished — in
    // which case there is nothing to upload and this step just advances
    // `nextIndex` past the gap for the next step to continue from.
    // Copied, not reused, before mutating — `state.uploadedParts` may be the
    // shared `EMPTY_STATE.uploadedParts` array literal for a job's first
    // step, and pushing onto that directly would leak into every other
    // job's default state.
    const newUploadedParts = [...state.uploadedParts];
    let nextPartNumber = state.partNumber;
    if (appended.bytes.length > 0) {
      const partNumber = state.partNumber + 1;
      const uploadedPart = await uploadExportPart(key, uploadId, partNumber, appended.bytes);
      newUploadedParts.push(uploadedPart);
      nextPartNumber = partNumber;
    }
    await persistStepIn(dbOrTx, eventId, jobId, lease, {
      nextIndex: state.nextIndex + consumed,
      exportFileId,
      uploadId,
      partNumber: nextPartNumber,
      offset: appended.state.offset,
      centralB64: bytesToBase64(appended.state.central),
      count: appended.state.count,
      timeMs: appended.state.timeMs,
      nameDedupe: nextNameDedupe,
      uploadedParts: newUploadedParts,
      claimedAt: null,
    });
  } catch (error) {
    if (currentUploadId && currentExportFileId) {
      await abortExportMultipart(buildExportZipKey(eventId, currentExportFileId), currentUploadId);
    }
    await failJobIn(dbOrTx, eventId, jobId, lease, error instanceof Error ? error.message : String(error));
  }
}

export const processFileExportJob = (eventId: EventId, jobId: string) => processFileExportJobIn(db, eventId, jobId);

/**
 * Expiry and cleanup: every completed job's ZIP is a private R2 object plus
 * a `file_assets` row (not the source deliverables, which this never
 * touches) — once `expires_at` passes, both are removed. A job that expired
 * while still `processing` also has an incomplete R2 multipart upload;
 * that's aborted too, so its parts don't linger as unreferenced storage no
 * future sweep would ever find (R2's own 7-day incomplete-upload lifecycle
 * is a backstop, not a substitute). Object deletes are best-effort and
 * independent per row, matching `cleanupOrphanUploads`'s own discipline: a
 * row whose object delete failed is still removed, and the stranded key is
 * logged rather than retried from a database that no longer has anywhere to
 * retry it from.
 *
 * Wired into the private cleanup cron slot alongside R2's own orphan sweep
 * and the M47 retention sweep (`src/app/worker-jobs/cleanup/route.ts`)
 * rather than self-scheduling here. That same cron tick is also this
 * module's fallback forward-progress mechanism for a job nobody is polling
 * (see `nudgeStalledFileExportsIn` below).
 */
export async function pruneExpiredFileExportsIn(dbOrTx: DbOrTx): Promise<{ deleted: number }> {
  const expired = await dbOrTx.execute<{ id: string; event_id: string; status: string; result_file_id: string | null; export_state: unknown }>(sql`
    DELETE FROM file_export_jobs
    WHERE expires_at IS NOT NULL AND expires_at < now()
    RETURNING id, event_id, status, result_file_id, export_state
  `);
  const rows = expired.rows ?? [];

  for (const row of rows) {
    if (row.status !== "processing") continue;
    const state = parseExportState(row.export_state);
    if (state.uploadId && state.exportFileId) {
      await abortExportMultipart(buildExportZipKey(row.event_id as EventId, state.exportFileId), state.uploadId);
    }
  }

  const resultFileIds = rows.flatMap((row) => (row.result_file_id ? [row.result_file_id] : []));
  if (resultFileIds.length > 0) {
    // The job row is already gone; the R2 object and its `file_assets` row
    // are the export's own artifact (never the source deliverables), so both
    // are removed here rather than left to the general orphan sweep — that
    // sweep's `ORPHAN_PREDICATE_SQL` deliberately excludes any row a live
    // `file_export_jobs.result_file_id` still points to, so it is this
    // function alone that ever reclaims a completed export's ZIP.
    const keys = await dbOrTx.execute<{ r2_key: string }>(sql`
      DELETE FROM file_assets WHERE id = ANY(${uuidArraySql(resultFileIds)}) RETURNING r2_key
    `);
    const { stranded } = await deleteObjects((keys.rows ?? []).map((row) => row.r2_key));
    reportStrandedObjects(stranded, { feature: "portal", requestId: "cron", code: "R2_STRANDED_EXPORT_PRUNE" });
  }
  return { deleted: rows.length };
}

export const pruneExpiredFileExports = () => pruneExpiredFileExportsIn(db);

/**
 * Belt-and-braces forward progress for a job nobody is polling (a closed
 * browser tab): advances every not-yet-expired `processing` job whose lease
 * is currently free by exactly one step, the same bounded unit
 * `processFileExportJobIn` always uses. Wired into the same cron tick as
 * `pruneExpiredFileExportsIn`; the ordinary path is still the Files view's
 * poll loop, which converges far faster than a once-a-day cron tick would.
 */
export async function nudgeStalledFileExportsIn(dbOrTx: DbOrTx): Promise<{ nudged: number; deferred: number }> {
  const stalled = await dbOrTx.execute<{ id: string; event_id: string; total: number }>(sql`
    SELECT id, event_id, count(*) OVER () AS total FROM file_export_jobs
    WHERE status = 'processing'
      AND (expires_at IS NULL OR expires_at > now())
      AND coalesce((export_state->>'claimedAt')::timestamptz, 'epoch'::timestamptz) < now() - interval '25 seconds'
    ORDER BY updated_at
    LIMIT ${NUDGE_BATCH_SIZE}
  `);
  const rows = stalled.rows ?? [];
  for (const row of rows) {
    await processFileExportJobIn(dbOrTx, row.event_id as EventId, row.id);
  }
  // Each step reads whole R2 objects, so an unbounded sweep would let a backlog
  // run one cron tick past its CPU budget and drop the whole batch. Oldest
  // first, bounded, and the remainder is reported rather than silently skipped.
  const deferred = Math.max(0, Number(rows[0]?.total ?? 0) - rows.length);
  return { nudged: rows.length, deferred };
}

export const nudgeStalledFileExports = () => nudgeStalledFileExportsIn(db);
