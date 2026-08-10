import { sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import {
  deliverableRowDtoSchema,
  type ContactId,
  type DeliverableRowDTO,
  type EventId,
  type FileRequestId,
  type TaskId,
} from "@/shared/contracts";

/**
 * The central Files view (M52): every file-request deliverable across the
 * event — one row per `task_assignments_v` row whose task is a file request —
 * with its latest version and version/comment counts folded in. Its routes
 * reuse tasks-admin's own `tasksAdminAuth` guard rather than a second copy —
 * this is the same event-scoped organizer boundary tasks-admin already
 * authorizes file requests under.
 */

export type DeliverableState = "all" | "open" | "overdue" | "completed";

export type DeliverableFilters = {
  taskId?: TaskId;
  fileRequestId?: FileRequestId;
  contactId?: ContactId;
  state?: DeliverableState;
  dueBefore?: string;
  dueAfter?: string;
  /** true = only slots with an uploaded version; false = only slots still empty. */
  hasUpload?: boolean;
  search?: string;
};

type DeliverableRow = {
  task_id: string; task_name: string; file_request_id: string; file_request_title: string;
  contact_id: string; contact_name: string; submission_id: string | null; submission_title: string | null;
  due_at: string | null; completed: boolean; completed_at: string | null; overdue: boolean;
  file_upload_id: string | null; file_asset_id: string | null; version: number | null;
  filename: string | null; size_bytes: string | number | null; mime: string | null; uploaded_at: string | null;
  version_count: number | string; comment_count: number | string;
};

function toDto(row: DeliverableRow): DeliverableRowDTO {
  return deliverableRowDtoSchema.parse({
    taskId: row.task_id,
    taskName: row.task_name,
    fileRequestId: row.file_request_id,
    fileRequestTitle: row.file_request_title,
    contactId: row.contact_id,
    contactName: row.contact_name,
    submissionId: row.submission_id,
    submissionTitle: row.submission_title,
    dueAt: row.due_at ? new Date(row.due_at).toISOString() : null,
    completed: row.completed,
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    overdue: row.overdue,
    latestVersion: row.file_upload_id && row.file_asset_id && row.version !== null
      ? {
        fileUploadId: row.file_upload_id,
        fileAssetId: row.file_asset_id,
        version: Number(row.version),
        isLatest: true,
        filename: row.filename ?? "",
        sizeBytes: Number(row.size_bytes ?? 0),
        mime: row.mime ?? "",
        uploadedAt: row.uploaded_at ? new Date(row.uploaded_at).toISOString() : new Date(0).toISOString(),
      }
      : null,
    versionCount: Number(row.version_count),
    commentCount: Number(row.comment_count),
  });
}

/**
 * Every filter is an `IS NULL OR` guard so an omitted filter is a true no-op —
 * the same discipline `listTasksIn`'s search/targetType filters already use —
 * rather than a query built up conditionally in TypeScript, which would risk
 * a filter silently applying to the wrong statement shape.
 */
export async function listDeliverablesIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  filters: DeliverableFilters = {},
): Promise<DeliverableRowDTO[]> {
  const state = filters.state && filters.state !== "all" ? filters.state : null;
  const search = filters.search?.trim() || null;
  const hasUpload = filters.hasUpload ?? null;
  const result = await dbOrTx.execute<DeliverableRow>(sql`
    SELECT
      v.task_id, t.name AS task_name, t.file_request_id, r.title AS file_request_title,
      v.contact_id, coalesce(nullif(btrim(c.first_name || ' ' || c.last_name), ''), c.email) AS contact_name,
      v.submission_id, s.title AS submission_title,
      v.due_at, v.completed, v.completed_at, v.overdue,
      latest.file_upload_id, latest.file_asset_id, latest.version, latest.filename, latest.size_bytes, latest.mime, latest.uploaded_at,
      coalesce((
        SELECT count(*) FROM file_uploads u2
        WHERE u2.event_id = v.event_id AND u2.file_request_id = t.file_request_id
          AND u2.contact_id = v.contact_id AND u2.submission_id IS NOT DISTINCT FROM v.submission_id
      ), 0) AS version_count,
      coalesce((
        SELECT count(*) FROM file_comments fc
        WHERE fc.event_id = v.event_id AND fc.file_request_id = t.file_request_id
          AND fc.contact_id = v.contact_id AND fc.submission_id IS NOT DISTINCT FROM v.submission_id
      ), 0) AS comment_count
    FROM task_assignments_v v
    JOIN portal_tasks t ON t.id = v.task_id AND t.event_id = v.event_id AND t.completion_mode = 'file_request'
    JOIN file_requests r ON r.id = t.file_request_id AND r.event_id = t.event_id
    JOIN contacts c ON c.id = v.contact_id AND c.event_id = v.event_id
    LEFT JOIN submissions s ON s.id = v.submission_id AND s.event_id = v.event_id
    LEFT JOIN LATERAL (
      SELECT u.id AS file_upload_id, u.file_asset_id, u.version, fa.filename, fa.size_bytes, fa.mime, u.created_at AS uploaded_at
      FROM file_uploads u
      JOIN file_assets fa ON fa.id = u.file_asset_id AND fa.event_id = u.event_id
      WHERE u.event_id = v.event_id AND u.file_request_id = t.file_request_id
        AND u.contact_id = v.contact_id AND u.submission_id IS NOT DISTINCT FROM v.submission_id AND u.is_latest
      LIMIT 1
    ) latest ON true
    WHERE v.event_id = ${eventId}
      AND (${filters.taskId ?? null}::uuid IS NULL OR t.id = ${filters.taskId ?? null}::uuid)
      AND (${filters.fileRequestId ?? null}::uuid IS NULL OR t.file_request_id = ${filters.fileRequestId ?? null}::uuid)
      AND (${filters.contactId ?? null}::uuid IS NULL OR v.contact_id = ${filters.contactId ?? null}::uuid)
      AND (
        ${state}::text IS NULL
        OR (${state}::text = 'open' AND NOT v.completed)
        OR (${state}::text = 'overdue' AND v.overdue)
        OR (${state}::text = 'completed' AND v.completed)
      )
      AND (${filters.dueBefore ?? null}::timestamptz IS NULL OR v.due_at <= ${filters.dueBefore ?? null}::timestamptz)
      AND (${filters.dueAfter ?? null}::timestamptz IS NULL OR v.due_at >= ${filters.dueAfter ?? null}::timestamptz)
      AND (${hasUpload}::boolean IS NULL OR (latest.file_upload_id IS NOT NULL) = ${hasUpload}::boolean)
      AND (
        ${search}::text IS NULL
        OR c.first_name ILIKE '%' || ${search} || '%' OR c.last_name ILIKE '%' || ${search} || '%'
        OR c.email ILIKE '%' || ${search} || '%' OR s.title ILIKE '%' || ${search} || '%'
        OR r.title ILIKE '%' || ${search} || '%'
      )
    ORDER BY v.completed, v.overdue DESC, v.due_at ASC NULLS LAST, contact_name, r.title
  `);
  return (result.rows ?? []).map(toDto);
}

export const listDeliverables = (eventId: EventId, filters?: DeliverableFilters) => listDeliverablesIn(db, eventId, filters);
