import { sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import {
  fileCommentDtoSchema,
  fileVersionDtoSchema,
  type ContactId,
  type EventId,
  type FileCommentDTO,
  type FileVersionDTO,
  type SubmissionId,
  type UserId,
} from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";

/**
 * M52 — the one deliverable "slot" a file request opens against a contact
 * (and, for a submission-targeted request, a specific submission): every
 * numbered version ever uploaded into it, and the plaintext comment thread
 * attached to it. Both task-runtime (the speaker's own task detail) and the
 * organizer's tasks-admin / central Files view read and write through this
 * module, so there is exactly one place that knows what a "slot" is — the
 * same discipline `contacts.ts` keeps for contact writes (resolution #13).
 *
 * A slot's identity is never a table of its own: it is the
 * `(file_request_id, contact_id, submission_id)` tuple `file_uploads` and
 * `file_comments` already key on, matching the task-runtime authorization
 * boundary (`task_assignments_v` × `portal_tasks.file_request_id`) below.
 */

type VersionRow = {
  file_upload_id: string;
  file_asset_id: string;
  version: number;
  is_latest: boolean;
  filename: string;
  size_bytes: string | number;
  mime: string;
  created_at: string;
};

function toVersionDto(row: VersionRow): FileVersionDTO {
  return fileVersionDtoSchema.parse({
    fileUploadId: row.file_upload_id,
    fileAssetId: row.file_asset_id,
    version: Number(row.version),
    isLatest: row.is_latest,
    filename: row.filename,
    sizeBytes: Number(row.size_bytes),
    mime: row.mime,
    uploadedAt: new Date(row.created_at).toISOString(),
  });
}

/** Newest first — the speaker's and the organizer's version panels both lead with what is current. */
export async function listFileVersionsIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  fileRequestId: string,
  contactId: ContactId,
  submissionId: SubmissionId | null,
): Promise<FileVersionDTO[]> {
  const result = await dbOrTx.execute<VersionRow>(sql`
    SELECT u.id AS file_upload_id, u.file_asset_id, u.version, u.is_latest, f.filename, f.size_bytes, f.mime, u.created_at
    FROM file_uploads u
    JOIN file_assets f ON f.id = u.file_asset_id AND f.event_id = u.event_id
    WHERE u.event_id = ${eventId} AND u.file_request_id = ${fileRequestId} AND u.contact_id = ${contactId}
      AND u.submission_id IS NOT DISTINCT FROM ${submissionId}
    ORDER BY u.version DESC
  `);
  return (result.rows ?? []).map(toVersionDto);
}

type CommentRow = { id: string; author_role: "organizer" | "speaker"; author_name: string; body: string; created_at: string };

const COMMENT_SELECT = sql`
  SELECT fc.id, fc.author_role, fc.body, fc.created_at,
    CASE
      WHEN fc.author_role = 'organizer' THEN coalesce(nullif(btrim(u.name), ''), u.email, 'Organizer')
      ELSE coalesce(nullif(btrim(ac.first_name || ' ' || ac.last_name), ''), ac.email, 'Speaker')
    END AS author_name
  FROM file_comments fc
  LEFT JOIN users u ON u.id = fc.author_user_id
  LEFT JOIN contacts ac ON ac.id = fc.author_contact_id AND ac.event_id = fc.event_id
`;

export async function listFileCommentsIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  fileRequestId: string,
  contactId: ContactId,
  submissionId: SubmissionId | null,
): Promise<FileCommentDTO[]> {
  const result = await dbOrTx.execute<CommentRow>(sql`
    ${COMMENT_SELECT}
    WHERE fc.event_id = ${eventId} AND fc.file_request_id = ${fileRequestId} AND fc.contact_id = ${contactId}
      AND fc.submission_id IS NOT DISTINCT FROM ${submissionId}
    ORDER BY fc.created_at ASC
  `);
  return (result.rows ?? []).map((row) => fileCommentDtoSchema.parse({
    id: row.id,
    authorRole: row.author_role,
    authorName: row.author_name,
    body: row.body,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

export type CommentAuthor = { role: "organizer"; userId: UserId } | { role: "speaker"; contactId: ContactId };

/**
 * The slot must already exist as a live assignment — a file request whose
 * owning task is assigned to this contact (and, for a submission-targeted
 * request, this submission) — before a comment can land on it. Reused rather
 * than re-derived: `task_assignments_v` is the same authorization boundary
 * `completeTaskViaUploadIn` already trusts for the upload itself.
 */
async function requireSlot(
  dbOrTx: DbOrTx,
  eventId: EventId,
  fileRequestId: string,
  contactId: ContactId,
  submissionId: SubmissionId | null,
): Promise<void> {
  const result = await dbOrTx.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n
    FROM task_assignments_v v
    JOIN portal_tasks t ON t.id = v.task_id AND t.event_id = v.event_id
    WHERE v.event_id = ${eventId} AND t.file_request_id = ${fileRequestId}
      AND v.contact_id = ${contactId} AND v.submission_id IS NOT DISTINCT FROM ${submissionId}
  `);
  if (Number((result.rows ?? [])[0]?.n ?? 0) === 0) throw new AppError("NOT_FOUND", "That deliverable was not found");
}

const MAX_COMMENT_LENGTH = 5_000;

/**
 * Plaintext only (this module's own guardrail) — never sanitized as HTML and
 * never rendered as HTML: the body lands in the database exactly as typed,
 * trimmed and length-capped, and every consumer renders it as text.
 */
export async function addFileCommentIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  fileRequestId: string,
  contactId: ContactId,
  submissionId: SubmissionId | null,
  author: CommentAuthor,
  body: string,
): Promise<FileCommentDTO> {
  const trimmed = body.trim();
  if (trimmed.length === 0) throw new AppError("VALIDATION", "Write something before sending");
  if (trimmed.length > MAX_COMMENT_LENGTH) throw new AppError("VALIDATION", `Keep comments under ${MAX_COMMENT_LENGTH} characters`);
  await requireSlot(dbOrTx, eventId, fileRequestId, contactId, submissionId);

  const inserted = await dbOrTx.execute<{ id: string }>(sql`
    INSERT INTO file_comments (event_id, file_request_id, contact_id, submission_id, author_role, author_user_id, author_contact_id, body)
    VALUES (
      ${eventId}, ${fileRequestId}, ${contactId}, ${submissionId}, ${author.role},
      ${author.role === "organizer" ? author.userId : null}, ${author.role === "speaker" ? author.contactId : null},
      ${trimmed}
    )
    RETURNING id
  `);
  const id = (inserted.rows ?? [])[0]?.id;
  if (!id) throw new AppError("INTERNAL", "The comment could not be saved");

  const result = await dbOrTx.execute<CommentRow>(sql`${COMMENT_SELECT} WHERE fc.id = ${id} AND fc.event_id = ${eventId}`);
  const row = (result.rows ?? [])[0];
  if (!row) throw new AppError("INTERNAL", "The comment could not be saved");
  return fileCommentDtoSchema.parse({
    id: row.id, authorRole: row.author_role, authorName: row.author_name, body: row.body,
    createdAt: new Date(row.created_at).toISOString(),
  });
}

export const listFileVersions = (eventId: EventId, fileRequestId: string, contactId: ContactId, submissionId: SubmissionId | null) =>
  listFileVersionsIn(db, eventId, fileRequestId, contactId, submissionId);
export const listFileComments = (eventId: EventId, fileRequestId: string, contactId: ContactId, submissionId: SubmissionId | null) =>
  listFileCommentsIn(db, eventId, fileRequestId, contactId, submissionId);
export const addFileComment = (
  eventId: EventId,
  fileRequestId: string,
  contactId: ContactId,
  submissionId: SubmissionId | null,
  author: CommentAuthor,
  body: string,
) => addFileCommentIn(db, eventId, fileRequestId, contactId, submissionId, author, body);
