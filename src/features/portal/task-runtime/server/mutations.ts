import { sql } from "drizzle-orm";
import { db, withTx, type DbOrTx, type TxDb } from "@/db/client";
import { deriveMappedFields, getCurrentSnapshotIn, runSubmitPipeline, type RawAnswers } from "@/features/forms";
import type { ContactId, EventId, FileCommentDTO, FileKind, FileVersionDTO, FormId, SubmissionId } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { log } from "@/shared/lib/log";
import { assertUploadAllowed, buildObjectKey } from "@/shared/server/r2";
import { updateContactFields } from "../../server/contacts";
import { addFileCommentIn, listFileVersionsIn } from "../../server/deliverable-slot";

/**
 * The three ways a speaker finishes a task.
 *
 * All three are authorized the same way: the insert selects its own row out of
 * `task_assignments_v`, so a task that is not routed to this contact simply
 * matches nothing. There is no separate "is this mine?" read to fall out of step
 * with the insert that follows it.
 *
 * `ON CONFLICT DO NOTHING` on `(task_id, contact_id, submission_id)` is what
 * makes a double-click one completion instead of an error. Two of these —
 * `completeTaskViaResponse` and `completeTaskViaUpload` — are audited `withTx`
 * paths, because the evidence row and the completion row have to land together:
 * a task marked done with no file behind it is worse than one still open.
 */

type Mode = "manual" | "form" | "file_request";

type UploadPolicy = { extensions: string[]; maxSizeMb: number };

type Assignment = {
  taskId: string;
  submissionId: string | null;
  formId: string | null;
  fileRequestId: string | null;
  /** The organizer's accepted types and size cap for this request, when there is one. */
  policy: UploadPolicy | null;
};

/**
 * The assignment as the database sees it, or a refusal. Used only where the
 * insert itself cannot carry the lookup — form mode needs the form id before it
 * can validate anything.
 */
async function requireAssignment(
  dbOrTx: DbOrTx,
  eventId: EventId,
  contactId: ContactId,
  taskId: string,
  submissionId: string | null,
  mode: Mode,
): Promise<Assignment> {
  const result = await dbOrTx.execute<{
    completion_mode: Mode; form_id: string | null; file_request_id: string | null;
    accepted_extensions: string[] | null; max_size_mb: number | null;
  }>(sql`
    SELECT t.completion_mode, t.form_id, t.file_request_id, r.accepted_extensions, r.max_size_mb
    FROM task_assignments_v v
    JOIN portal_tasks t ON t.id = v.task_id AND t.event_id = v.event_id
    LEFT JOIN file_requests r ON r.id = t.file_request_id AND r.event_id = t.event_id
    WHERE v.event_id = ${eventId} AND v.contact_id = ${contactId} AND v.task_id = ${taskId}
      AND v.submission_id IS NOT DISTINCT FROM ${submissionId}
  `);
  const row = (result.rows ?? [])[0];
  // A task belonging to someone else reads exactly like one that does not exist.
  if (!row) throw new AppError("NOT_FOUND", "Task not found");
  if (row.completion_mode !== mode) {
    throw new AppError("VALIDATION", `This task is completed by ${row.completion_mode.replace("_", " ")}, not by ${mode.replace("_", " ")}`);
  }
  return {
    taskId,
    submissionId,
    formId: row.form_id,
    fileRequestId: row.file_request_id,
    policy: row.accepted_extensions && row.max_size_mb !== null
      ? { extensions: row.accepted_extensions, maxSizeMb: Number(row.max_size_mb) }
      : null,
  };
}

/**
 * The file behind a completion has to actually exist, belong to this speaker,
 * and have finished uploading — and, for a file request, satisfy the policy the
 * organizer set on it.
 *
 * Ownership alone is not enough. `finalizeUpload` publishes an object under its
 * immutable key and only then points the row at it, so a row still holding its
 * staging key is a presign nobody completed: accepting one marks a task done
 * with evidence that was never stored. And because `file_assets` does not record
 * which request minted it, the accepted types and size cap have to be re-checked
 * here or a file presigned under a laxer request answers this one.
 */
async function requireFinishedUpload(
  dbOrTx: DbOrTx,
  eventId: EventId,
  contactId: ContactId,
  fileAssetId: string,
  policy: UploadPolicy | null,
): Promise<void> {
  const result = await dbOrTx.execute<{
    id: string; kind: string; filename: string; mime: string; size_bytes: string | number; r2_key: string;
  }>(sql`
    SELECT id, kind, filename, mime, size_bytes, r2_key FROM file_assets
    WHERE id = ${fileAssetId} AND event_id = ${eventId} AND uploaded_by_contact_id = ${contactId}
  `);
  const asset = (result.rows ?? [])[0];
  if (!asset) throw new AppError("NOT_FOUND", "That file is not one of your uploads");

  const published = buildObjectKey({ eventId, kind: asset.kind as FileKind, fileId: asset.id, filename: asset.filename });
  if (asset.r2_key !== published) {
    throw new AppError("VALIDATION", "That upload did not finish — send the file again");
  }

  if (!policy) return;
  // Kind is the other half of the same question: a headshot is not an answer to
  // a slides request, whatever its extension says.
  if (asset.kind !== "upload") throw new AppError("VALIDATION", "That file was not uploaded for this request");
  assertUploadAllowed({
    kind: "upload",
    filename: asset.filename,
    mime: asset.mime,
    sizeBytes: Number(asset.size_bytes),
    policyOverride: policy,
  });
}

/**
 * Manual mode: one guarded statement, no transaction. There is nothing else to
 * write atomically with it, and `withTx` is confined to the eight audited paths.
 */
export async function completeTaskManualIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  contactId: ContactId,
  taskId: string,
  submissionId: string | null,
): Promise<void> {
  const result = await dbOrTx.execute<{ id: string }>(sql`
    INSERT INTO task_completions (event_id, task_id, contact_id, submission_id, completed_via)
    SELECT v.event_id, v.task_id, v.contact_id, v.submission_id, 'manual'
    FROM task_assignments_v v
    JOIN portal_tasks t ON t.id = v.task_id AND t.event_id = v.event_id
    WHERE v.event_id = ${eventId} AND v.contact_id = ${contactId} AND v.task_id = ${taskId}
      AND v.submission_id IS NOT DISTINCT FROM ${submissionId}
      AND t.completion_mode = 'manual'
    ON CONFLICT DO NOTHING
    RETURNING id
  `);
  if ((result.rows ?? []).length > 0) return;

  // Nothing was written: either it was already done — the double-click this
  // guard exists for — or the task is not this speaker's.
  const existing = await dbOrTx.execute<{ id: string }>(sql`
    SELECT id FROM task_completions
    WHERE event_id = ${eventId} AND task_id = ${taskId} AND contact_id = ${contactId}
      AND submission_id IS NOT DISTINCT FROM ${submissionId}
  `);
  if ((existing.rows ?? []).length > 0) return;
  await requireAssignment(dbOrTx, eventId, contactId, taskId, submissionId, "manual");
  throw new AppError("INTERNAL", "The task could not be completed");
}

/**
 * File mode. Audited `withTx` path #6: the upload row and the completion row are
 * one unit, and the completion is written second — a task must never read as
 * done with no file behind it.
 *
 * A second upload against a finished task adds another file and repoints the
 * completion at it, because "replace" is send-another, not delete-and-resend —
 * and the organizer must be shown the version the speaker actually meant.
 */
export async function completeTaskViaUploadIn(
  tx: TxDb,
  eventId: EventId,
  contactId: ContactId,
  taskId: string,
  submissionId: string | null,
  fileAssetId: string,
): Promise<FileVersionDTO> {
  const assignment = await requireAssignment(tx, eventId, contactId, taskId, submissionId, "file_request");
  if (!assignment.fileRequestId) throw new AppError("VALIDATION", "This task has no file request attached");

  // Without the ownership half of this check a speaker could answer their task
  // with another speaker's private deck — and, because `file_uploads` grants
  // download rights, hand themselves a presigned URL to it.
  await requireFinishedUpload(tx, eventId, contactId, fileAssetId, assignment.policy);

  // M52: numbered, server-derived versions. The prior latest row (if any) is
  // flipped off in the same statement that inserts the new one — a client
  // never supplies `version`/`isLatest` (the module's own "latest is
  // server-derived" guardrail), and there is no window where the slot has
  // zero or two latest rows for a concurrent reader to observe.
  const uploaded = await tx.execute<{ id: string }>(sql`
    WITH prev AS (
      UPDATE file_uploads SET is_latest = false
      WHERE event_id = ${eventId} AND file_request_id = ${assignment.fileRequestId}
        AND contact_id = ${contactId} AND submission_id IS NOT DISTINCT FROM ${submissionId} AND is_latest
      RETURNING version
    )
    INSERT INTO file_uploads (event_id, file_request_id, contact_id, submission_id, file_asset_id, version, is_latest)
    VALUES (
      ${eventId}, ${assignment.fileRequestId}, ${contactId}, ${submissionId}, ${fileAssetId},
      coalesce((SELECT max(version) + 1 FROM prev), 1), true
    )
    RETURNING id
  `);
  const fileUploadId = (uploaded.rows ?? [])[0]?.id;
  if (!fileUploadId) throw new AppError("INTERNAL", "The upload could not be recorded");

  // A re-upload keeps the original completion time — the task was finished
  // then — but must repoint at the newest file, or the organizer keeps being
  // served the version the speaker replaced.
  await tx.execute(sql`
    INSERT INTO task_completions (event_id, task_id, contact_id, submission_id, completed_via, file_upload_id)
    VALUES (${eventId}, ${taskId}, ${contactId}, ${submissionId}, 'file_upload', ${fileUploadId})
    ON CONFLICT (task_id, contact_id, submission_id) DO UPDATE SET
      completed_via = 'file_upload', file_upload_id = EXCLUDED.file_upload_id
  `);

  // Return the exact row the organizer and task detail views will read. This
  // keeps the client from reconstructing a version number, latest marker, or
  // timestamp and lets the speaker see a successful attachment immediately.
  const version = (await listFileVersionsIn(
    tx,
    eventId,
    assignment.fileRequestId,
    contactId,
    submissionId as SubmissionId | null,
  )).find((entry) => entry.fileUploadId === fileUploadId);
  if (!version) throw new AppError("INTERNAL", "The uploaded version could not be read back");
  return version;
}

/**
 * M52 — a speaker's comment on their own file-request deliverable. The task
 * is resolved into its `fileRequestId` the same way `completeTaskViaUpload`
 * does (`requireAssignment`, mode-checked), so a comment can never be pinned
 * to a task that is not this speaker's or is not a file request in the first
 * place — the same authorization boundary as the upload itself.
 */
export async function addTaskCommentIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  contactId: ContactId,
  taskId: string,
  submissionId: string | null,
  body: string,
): Promise<FileCommentDTO> {
  const assignment = await requireAssignment(dbOrTx, eventId, contactId, taskId, submissionId, "file_request");
  if (!assignment.fileRequestId) throw new AppError("VALIDATION", "This task has no file request attached");
  return addFileCommentIn(
    dbOrTx, eventId, assignment.fileRequestId, contactId, submissionId as SubmissionId | null,
    { role: "speaker", contactId }, body,
  );
}

export const addTaskComment = (eventId: EventId, contactId: ContactId, taskId: string, submissionId: string | null, body: string) =>
  addTaskCommentIn(db, eventId, contactId, taskId, submissionId, body);

/** The submission columns a portal form is allowed to write, and their SQL names. */
const SUBMISSION_COLUMNS = {
  title: sql`title`,
  descriptionHtml: sql`description_html`,
  trackId: sql`track_id`,
  formatId: sql`format_id`,
  level: sql`level`,
} as const;

/**
 * Form mode. Audited `withTx` path #7: the response, the write-back and the
 * completion are one unit.
 *
 * The snapshot is re-fetched here rather than trusted from the client — an
 * organizer may have edited the form between render and submit — and the same
 * `runSubmitPipeline` the public CFP uses does the parsing, stripping and
 * validation, so there is one definition of a valid answer in the repository.
 */
export async function completeTaskViaResponseIn(
  tx: TxDb,
  eventId: EventId,
  contactId: ContactId,
  taskId: string,
  submissionId: string | null,
  answers: RawAnswers,
): Promise<void> {
  const assignment = await requireAssignment(tx, eventId, contactId, taskId, submissionId, "form");
  if (!assignment.formId) throw new AppError("VALIDATION", "This task has no form attached");

  const snapshot = await getCurrentSnapshotIn(tx, eventId, assignment.formId as FormId);
  const pipeline = runSubmitPipeline(snapshot, answers, { participantId: null, requireRequired: true });
  if (!pipeline.ok) throw new AppError("VALIDATION", "Some answers need fixing", { fieldErrors: pipeline.fieldErrors });
  if (pipeline.discarded.length > 0) {
    // A field the organizer removed after this page rendered is dropped, not a
    // 500 in the speaker's face.
    log({
      level: "info", msg: "portal.task.answers_discarded", requestId: taskId, feature: "portal",
      eventId, code: pipeline.discarded.join(","),
    });
  }

  // A jsonb **object** keyed by field id, not the CleanAnswers array: R2's
  // orphan sweep looks for `{t:'file'}` values with `jsonb_each` over this
  // column, and an array reads as "no file referenced" — which deletes a file
  // the response still points at.
  // The pipeline validates an answer's *shape*, so `{t:'file'}` carrying any
  // syntactically valid uuid would otherwise satisfy a required upload with
  // evidence that does not exist or belongs to somebody else.
  for (const answer of pipeline.clean) {
    if (answer.value.t === "file") await requireFinishedUpload(tx, eventId, contactId, answer.value.v, null);
  }

  const answersObject = Object.fromEntries(pipeline.clean.map((answer) => [answer.fieldId, answer.value]));
  const response = await tx.execute<{ id: string }>(sql`
    INSERT INTO form_responses (event_id, form_id, form_version, contact_id, submission_id, answers)
    VALUES (${eventId}, ${assignment.formId}, ${snapshot.version}, ${contactId}, ${submissionId}, ${JSON.stringify(answersObject)}::jsonb)
    ON CONFLICT (form_id, contact_id, submission_id) DO UPDATE SET
      answers = EXCLUDED.answers, form_version = EXCLUDED.form_version, updated_at = now()
    RETURNING id
  `);
  const responseId = (response.rows ?? [])[0]?.id;
  if (!responseId) throw new AppError("INTERNAL", "The response could not be saved");

  // Write-back is field-scoped in both directions: a portal form that asks for a
  // bio must not overwrite the company someone edited on the Profile page a
  // minute ago. `deriveMappedFields` is the one place `mapsTo` is interpreted.
  const mapped = deriveMappedFields(snapshot, pipeline.clean);
  if (Object.keys(mapped.contact).length > 0) {
    await updateContactFields(tx, eventId, contactId, mapped.contact);
  }
  // The allowlist enforces itself rather than being asserted into: a key it does
  // not define would build `undefined = $n` and fail the UPDATE with a syntax
  // error inside the transaction, costing the speaker their whole response.
  const submissionPatch = Object.entries(mapped.submission).flatMap(([column, value]) => {
    if (value === undefined) return [];
    const target = Object.hasOwn(SUBMISSION_COLUMNS, column)
      ? SUBMISSION_COLUMNS[column as keyof typeof SUBMISSION_COLUMNS]
      : null;
    if (!target) {
      log({ level: "warn", msg: "portal.task.unmapped_submission_column", requestId: taskId, feature: "portal", eventId, code: column });
      return [];
    }
    return [sql`${target} = ${value ?? null}`];
  });
  if (submissionPatch.length > 0 && submissionId) {
    await tx.execute(sql`
      UPDATE submissions SET ${sql.join(submissionPatch, sql`, `)}, updated_at = now()
      WHERE id = ${submissionId} AND event_id = ${eventId}
    `);
  } else if (submissionPatch.length > 0) {
    // A contact-targeted task cannot write submission columns — there is no
    // submission in scope. Say so, rather than discarding the answers silently.
    log({ level: "warn", msg: "portal.task.submission_writeback_skipped", requestId: taskId, feature: "portal", eventId });
  }

  await tx.execute(sql`
    INSERT INTO task_completions (event_id, task_id, contact_id, submission_id, completed_via, form_response_id)
    VALUES (${eventId}, ${taskId}, ${contactId}, ${submissionId}, 'form_response', ${responseId})
    ON CONFLICT DO NOTHING
  `);
}

export const completeTaskManual = (eventId: EventId, contactId: ContactId, taskId: string, submissionId: string | null) =>
  completeTaskManualIn(db, eventId, contactId, taskId, submissionId);

export const completeTaskViaUpload = (
  eventId: EventId, contactId: ContactId, taskId: string, submissionId: string | null, fileAssetId: string,
) => withTx((tx) => completeTaskViaUploadIn(tx, eventId, contactId, taskId, submissionId, fileAssetId));

export const completeTaskViaResponse = (
  eventId: EventId, contactId: ContactId, taskId: string, submissionId: string | null, answers: RawAnswers,
) => withTx((tx) => completeTaskViaResponseIn(tx, eventId, contactId, taskId, submissionId, answers));
