import { sql, type SQL } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import {
  fileExportJobDtoSchema,
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
import { deleteObjects, getObjectBytes, putExportZip } from "@/shared/server/r2";
import { buildZip, uniqueZipNames } from "./zip";

/**
 * M52 — asynchronous latest-file ZIP export. Two phases:
 *
 *  1. `createFileExportJobIn` re-derives each selected slot's *current*
 *     latest file server-side (never trusting a client-supplied file id or
 *     "latest" claim — the module's own guardrail) and freezes that set into
 *     the job row, so the export never widens to a file uploaded after the
 *     request.
 *  2. `processFileExportJobIn` claims the job, reads every source object's
 *     bytes through `r2.ts`'s two export-only functions, builds the archive
 *     in memory and publishes it as a new `file_assets` row.
 *
 * Neither function is one of the eight `withTx`-audited paths: each issues
 * its own single guarded statement (or, for `process`, a sequence of
 * independent statements bookended by a claim and a terminal status write) —
 * a crash mid-build leaves the job `processing` forever rather than
 * corrupting another job's row, and a stuck job is a support ticket, not a
 * data-integrity incident.
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

function uuidArraySql(ids: readonly string[]): SQL {
  if (ids.length === 0) return sql`'{}'::uuid[]`;
  return sql`ARRAY[${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}]`;
}

const MAX_TARGETS = 200;

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
  if (targets.length > MAX_TARGETS) throw new AppError("VALIDATION", `Export up to ${MAX_TARGETS} deliverables at a time`);

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

/** Claims a pending job for processing; null if it was already claimed, finished, or does not exist. */
async function claimJobIn(dbOrTx: DbOrTx, eventId: EventId, jobId: string): Promise<{ groupBy: FileExportGroupBy; fileUploadIds: string[] } | null> {
  const claimed = await dbOrTx.execute<{ group_by: FileExportGroupBy; file_upload_ids: string[] | null }>(sql`
    UPDATE file_export_jobs SET status = 'processing', updated_at = now()
    WHERE id = ${jobId} AND event_id = ${eventId} AND status = 'pending'
    RETURNING group_by, file_upload_ids
  `);
  const row = (claimed.rows ?? [])[0];
  return row ? { groupBy: row.group_by, fileUploadIds: row.file_upload_ids ?? [] } : null;
}

async function failJobIn(dbOrTx: DbOrTx, eventId: EventId, jobId: string, message: string): Promise<void> {
  await dbOrTx.execute(sql`
    UPDATE file_export_jobs SET status = 'failed', error = ${message.slice(0, 1000)}, updated_at = now(), completed_at = now()
    WHERE id = ${jobId} AND event_id = ${eventId}
  `);
}

type ExportFileRow = { file_upload_id: string; r2_key: string; filename: string; group_label: string | null };

function groupLabelSql(groupBy: FileExportGroupBy): SQL {
  if (groupBy === "session") return sql`s.title`;
  if (groupBy === "speaker") return sql`coalesce(nullif(btrim(c.first_name || ' ' || c.last_name), ''), c.email)`;
  return sql`NULL::text`;
}

/**
 * Reads every selected object's bytes, builds the archive and publishes it.
 * Never throws for a caller to catch — every failure path, including one
 * this function did not anticipate, lands the job in `failed` with a message
 * rather than leaving it stuck in `processing` forever.
 */
export async function processFileExportJobIn(dbOrTx: DbOrTx, eventId: EventId, jobId: string): Promise<void> {
  const claim = await claimJobIn(dbOrTx, eventId, jobId);
  if (!claim) return;

  try {
    if (claim.fileUploadIds.length === 0) throw new AppError("VALIDATION", "This export has no files to include");

    // Re-scoped to `eventId` again here, on top of the scoping already done
    // when the ids were resolved at creation — an export job re-checks
    // authorization at the point it actually touches file bytes, not only
    // when it was queued.
    const rows = await dbOrTx.execute<ExportFileRow>(sql`
      SELECT u.id AS file_upload_id, fa.r2_key, fa.filename, ${groupLabelSql(claim.groupBy)} AS group_label
      FROM file_uploads u
      JOIN file_assets fa ON fa.id = u.file_asset_id AND fa.event_id = u.event_id
      JOIN contacts c ON c.id = u.contact_id AND c.event_id = u.event_id
      LEFT JOIN submissions s ON s.id = u.submission_id AND s.event_id = u.event_id
      WHERE u.event_id = ${eventId} AND u.id = ANY(${uuidArraySql(claim.fileUploadIds)})
    `);
    const files = rows.rows ?? [];
    if (files.length === 0) throw new AppError("VALIDATION", "None of the selected files could be found");

    const names = uniqueZipNames(files.map((file) => ({ group: file.group_label, filename: file.filename })));
    const entries: { name: string; data: Uint8Array }[] = [];
    for (const [index, file] of files.entries()) {
      const bytes = await getObjectBytes(file.r2_key);
      // A row whose object went missing (should not happen; immutable keys
      // are never overwritten or deleted while referenced) is skipped rather
      // than failing the whole export for everyone else in the batch.
      if (bytes) entries.push({ name: names[index] ?? file.filename, data: bytes });
    }
    if (entries.length === 0) throw new AppError("INTERNAL", "No file bytes could be read for this export");

    const zip = buildZip(entries);
    const { fileId } = await putExportZip(eventId, jobId, zip);

    await dbOrTx.execute(sql`
      UPDATE file_export_jobs
      SET status = 'completed', result_file_id = ${fileId}, entry_count = ${entries.length}, updated_at = now(), completed_at = now()
      WHERE id = ${jobId} AND event_id = ${eventId}
    `);
  } catch (error) {
    await failJobIn(dbOrTx, eventId, jobId, error instanceof Error ? error.message : String(error));
  }
}

export const processFileExportJob = (eventId: EventId, jobId: string) => processFileExportJobIn(db, eventId, jobId);

/**
 * Expiry and cleanup: every completed job's ZIP is a private R2 object plus
 * a `file_assets` row (not the source deliverables, which this never
 * touches) — once `expires_at` passes, both are removed. Object deletes are
 * best-effort and independent per row, matching `cleanupOrphanUploads`'s own
 * discipline: a row whose object delete failed is still removed, and the
 * stranded key is logged rather than retried from a database that no longer
 * has anywhere to retry it from.
 *
 * Wired into the existing `/api/jobs/cleanup` cron slot alongside R2's own
 * orphan sweep and the M47 retention sweep (`src/app/api/jobs/cleanup/route.ts`)
 * rather than self-scheduling here.
 */
export async function pruneExpiredFileExportsIn(dbOrTx: DbOrTx): Promise<{ deleted: number }> {
  const expired = await dbOrTx.execute<{ id: string; result_file_id: string | null }>(sql`
    DELETE FROM file_export_jobs
    WHERE expires_at IS NOT NULL AND expires_at < now()
    RETURNING id, result_file_id
  `);
  const rows = expired.rows ?? [];
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
    if (stranded.length > 0) {
      log({ level: "warn", msg: "deliverables.export.object_delete_failed", requestId: "cron", feature: "portal", code: stranded.join(",") });
    }
  }
  return { deleted: rows.length };
}

export const pruneExpiredFileExports = () => pruneExpiredFileExportsIn(db);
