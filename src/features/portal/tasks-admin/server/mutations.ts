import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "@/db/client";
import { fileRequests, forms, portalTasks } from "@/db/schema";
import {
  fileRequestIdSchema,
  formIdSchema,
  taskDtoSchema,
  taskIdSchema,
  taskModeSchema,
  taskTargetSchema,
  type ContactId,
  type EventId,
  type SubmissionId,
  type TaskDTO,
  type TaskId,
} from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { sanitize } from "@/shared/lib/sanitize";
import { endOfDayInTz } from "@/shared/lib/time";
import { getEventTimezoneIn, type FileRequestDTO } from "./queries";
import { DEFAULT_ACCEPTED_EXTENSIONS } from "../constants";

/**
 * A date-only picker input, `YYYY-MM-DD` — never a full timestamp. Accepting
 * anything else here would let a naive `new Date(dateString)` slip back in one
 * layer up; the only way this module writes `due_at` is through
 * `endOfDayInTz`, below.
 */
const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be a date, YYYY-MM-DD");

/**
 * The zod mirror of `portal_tasks`' CHECK constraints — friendlier than the DB
 * error, and it runs before any row is touched.
 */
export const saveTaskInputSchema = z.object({
  id: taskIdSchema.optional(),
  name: z.string().trim().min(1).max(255),
  descriptionHtml: z.string().max(100_000).default(""),
  targetType: taskTargetSchema,
  completionMode: taskModeSchema,
  formId: formIdSchema.nullable().optional(),
  fileRequestId: fileRequestIdSchema.nullable().optional(),
  dueAt: dateOnlySchema.nullable().optional(),
  isActive: z.boolean().default(true),
}).superRefine((input, ctx) => {
  const formId = input.formId ?? null;
  const fileRequestId = input.fileRequestId ?? null;
  const valid = input.completionMode === "manual"
    ? formId === null && fileRequestId === null
    : input.completionMode === "form"
      ? formId !== null && fileRequestId === null
      : formId === null && fileRequestId !== null;
  if (!valid) {
    ctx.addIssue({ code: "custom", path: ["completionMode"], message: "Completion mode and its attached form/file request must match" });
  }
});
export type SaveTaskInput = z.infer<typeof saveTaskInputSchema>;

type TaskRow = {
  id: string; name: string; description_html: string; target_type: string; completion_mode: string;
  form_id: string | null; file_request_id: string | null; due_at: string | null; is_active: boolean; created_at: string;
};

function toTaskDto(row: TaskRow): TaskDTO {
  return taskDtoSchema.parse({
    id: row.id,
    name: row.name,
    descriptionHtml: row.description_html,
    targetType: row.target_type,
    completionMode: row.completion_mode,
    formId: row.form_id,
    fileRequestId: row.file_request_id,
    dueAt: row.due_at ? new Date(row.due_at).toISOString() : null,
    isActive: row.is_active,
    createdAt: new Date(row.created_at).toISOString(),
  });
}

/**
 * Create or update a task in one statement — no `withTx`, this is not one of
 * the eight audited transactional paths (driver resolution #4). Everything
 * that can reject the write happens in reads *before* the statement, so the
 * statement itself is the only place a row is touched.
 *
 * **Mode-lock** (analysis trap #4): re-checked here on every call, not only in
 * the UI's disabled button, because a curl'd PATCH has no button to disable.
 * Switching `targetType`, `completionMode`, `formId` or `fileRequestId` once
 * `task_completions` holds a row for this task is rejected with the same
 * `FORM_LOCKED` code the form builder uses for its own structure-freeze — the
 * closed `APP_ERROR_CODES` enum has no `TASK_LOCKED`, and this is the same
 * "structure frozen by existing responses" meaning.
 */
export async function saveTaskIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  input: SaveTaskInput,
  options: { createIfMissing?: boolean } = {},
): Promise<TaskDTO> {
  const timezone = await getEventTimezoneIn(dbOrTx, eventId);
  const formId = input.formId ?? null;
  const fileRequestId = input.fileRequestId ?? null;

  if (input.id) {
    const [existing] = await dbOrTx.select({
      targetType: portalTasks.targetType,
      completionMode: portalTasks.completionMode,
      formId: portalTasks.formId,
      fileRequestId: portalTasks.fileRequestId,
    }).from(portalTasks).where(and(eq(portalTasks.id, input.id), eq(portalTasks.eventId, eventId))).limit(1);
    if (!existing && !options.createIfMissing) throw new AppError("NOT_FOUND", "Task not found");

    const shapeChanged = existing !== undefined && (existing.targetType !== input.targetType
      || existing.completionMode !== input.completionMode
      || (existing.formId ?? null) !== formId
      || (existing.fileRequestId ?? null) !== fileRequestId);
    if (shapeChanged) {
      const completions = await dbOrTx.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM task_completions WHERE task_id = ${input.id} AND event_id = ${eventId}
      `);
      if (Number((completions.rows ?? [])[0]?.n ?? 0) > 0) {
        throw new AppError("FORM_LOCKED", "This task has completions. Create a new task to change its type.");
      }
    }
  }

  if (formId) {
    const [row] = await dbOrTx.select({ id: forms.id }).from(forms).where(and(eq(forms.id, formId), eq(forms.eventId, eventId))).limit(1);
    if (!row) throw new AppError("VALIDATION", "That form does not belong to this event");
  }
  if (fileRequestId) {
    const [row] = await dbOrTx.select({ id: fileRequests.id }).from(fileRequests).where(and(eq(fileRequests.id, fileRequestId), eq(fileRequests.eventId, eventId))).limit(1);
    if (!row) throw new AppError("VALIDATION", "That file request does not belong to this event");
  }

  // Date-only in, `endOfDayInTz` out — never a naive `new Date(dateString)`,
  // which parses as UTC midnight and is wrong by up to a day against the
  // event's own timezone (analysis trap #9 / resolution #9).
  const dueAt = input.dueAt ? endOfDayInTz(input.dueAt, timezone) : null;
  const descriptionHtml = sanitize(input.descriptionHtml ?? "");

  const result = await dbOrTx.execute<TaskRow>(sql`
    INSERT INTO portal_tasks (id, event_id, name, description_html, target_type, completion_mode, form_id, file_request_id, due_at, is_active, sort_order)
    VALUES (
      COALESCE(${input.id ?? null}::uuid, gen_random_uuid()), ${eventId}, ${input.name}, ${descriptionHtml},
      ${input.targetType}::task_target, ${input.completionMode}::task_mode, ${formId}, ${fileRequestId},
      ${dueAt}, ${input.isActive},
      COALESCE(
        (SELECT sort_order FROM portal_tasks WHERE id = ${input.id ?? null}::uuid AND event_id = ${eventId}),
        (SELECT coalesce(max(sort_order) + 1, 0) FROM portal_tasks WHERE event_id = ${eventId})
      )
    )
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name, description_html = EXCLUDED.description_html,
      target_type = EXCLUDED.target_type, completion_mode = EXCLUDED.completion_mode,
      form_id = EXCLUDED.form_id, file_request_id = EXCLUDED.file_request_id,
      due_at = EXCLUDED.due_at, is_active = EXCLUDED.is_active, updated_at = now()
    WHERE portal_tasks.event_id = ${eventId}
    RETURNING id, name, description_html, target_type, completion_mode, form_id, file_request_id, due_at, is_active, created_at
  `);
  const row = (result.rows ?? [])[0];
  if (!row) throw new AppError("INTERNAL", "The task could not be saved");
  return toTaskDto(row);
}

/** POST/create variant: a supplied id is an idempotency key and may insert on
 * its first use. PATCH continues through `saveTaskIn` and never creates a
 * missing path id. */
export const createTaskIn = (dbOrTx: DbOrTx, eventId: EventId, input: SaveTaskInput): Promise<TaskDTO> =>
  saveTaskIn(dbOrTx, eventId, input, { createIfMissing: true });

export async function deleteTaskIn(dbOrTx: DbOrTx, eventId: EventId, taskId: TaskId): Promise<void> {
  const result = await dbOrTx.execute<{ id: string }>(sql`
    DELETE FROM portal_tasks WHERE id = ${taskId} AND event_id = ${eventId} RETURNING id
  `);
  if ((result.rows ?? []).length === 0) throw new AppError("NOT_FOUND", "Task not found");
}

/**
 * Every speaker owes a task exactly nothing until an organizer reopens it —
 * this never inserts into `task_completions`; it only deletes the one row a
 * completion left behind. Reminders do not resume with a fresh ladder: their
 * idempotency keys stay consumed (data-model.md §4.3), which is why this is a
 * plain delete and not a status flip.
 */
export async function reopenCompletionIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  taskId: TaskId,
  contactId: ContactId,
  submissionId: SubmissionId | null,
): Promise<void> {
  await dbOrTx.execute(sql`
    DELETE FROM task_completions
    WHERE event_id = ${eventId} AND task_id = ${taskId} AND contact_id = ${contactId}
      AND submission_id IS NOT DISTINCT FROM ${submissionId}
  `);
}

export { DEFAULT_ACCEPTED_EXTENSIONS } from "../constants";

export const saveFileRequestInputSchema = z.object({
  id: fileRequestIdSchema.optional(),
  title: z.string().trim().min(1).max(255),
  targetType: taskTargetSchema,
  instructionsHtml: z.string().max(100_000).default(""),
  acceptedExtensions: z.array(z.string().trim().toLowerCase().min(1).max(10)).min(1).default([...DEFAULT_ACCEPTED_EXTENSIONS]),
  maxSizeMb: z.number().int().positive().max(5000).default(100),
});
export type SaveFileRequestInput = z.infer<typeof saveFileRequestInputSchema>;

type FileRequestRow = {
  id: string; title: string; target_type: string; instructions_html: string | null;
  accepted_extensions: string[]; max_size_mb: number; created_at: string; updated_at: string;
};

function toFileRequestDto(row: FileRequestRow): FileRequestDTO {
  return {
    id: row.id,
    title: row.title,
    targetType: row.target_type as FileRequestDTO["targetType"],
    instructionsHtml: row.instructions_html ?? "",
    acceptedExtensions: row.accepted_extensions ?? [],
    maxSizeMb: Number(row.max_size_mb),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function saveFileRequestIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  input: SaveFileRequestInput,
  options: { createIfMissing?: boolean } = {},
): Promise<FileRequestDTO> {
  if (input.id && !options.createIfMissing) {
    const [existing] = await dbOrTx.select({ id: fileRequests.id }).from(fileRequests)
      .where(and(eq(fileRequests.id, input.id), eq(fileRequests.eventId, eventId)))
      .limit(1);
    if (!existing) throw new AppError("NOT_FOUND", "File request not found");
  }
  const instructionsHtml = sanitize(input.instructionsHtml ?? "");
  const extensions = [...new Set(input.acceptedExtensions.map((extension) => extension.replace(/^\./, "")))];
  const extensionsSql = sql`ARRAY[${sql.join(extensions.map((extension) => sql`${extension}`), sql`, `)}]::text[]`;

  const result = await dbOrTx.execute<FileRequestRow>(sql`
    INSERT INTO file_requests (id, event_id, title, target_type, instructions_html, accepted_extensions, max_size_mb)
    VALUES (
      COALESCE(${input.id ?? null}::uuid, gen_random_uuid()), ${eventId}, ${input.title}, ${input.targetType}::task_target,
      ${instructionsHtml}, ${extensionsSql}, ${input.maxSizeMb}
    )
    ON CONFLICT (id) DO UPDATE SET
      title = EXCLUDED.title, target_type = EXCLUDED.target_type, instructions_html = EXCLUDED.instructions_html,
      accepted_extensions = EXCLUDED.accepted_extensions, max_size_mb = EXCLUDED.max_size_mb, updated_at = now()
    WHERE file_requests.event_id = ${eventId}
    RETURNING id, title, target_type, instructions_html, accepted_extensions, max_size_mb, created_at, updated_at
  `);
  const row = (result.rows ?? [])[0];
  if (!row) throw new AppError("NOT_FOUND", "File request not found");
  return toFileRequestDto(row);
}

/** Collection POST counterpart to `saveFileRequestIn`; see `createTaskIn`. */
export const createFileRequestIn = (dbOrTx: DbOrTx, eventId: EventId, input: SaveFileRequestInput): Promise<FileRequestDTO> =>
  saveFileRequestIn(dbOrTx, eventId, input, { createIfMissing: true });

/**
 * RESTRICT is the backstop (`file_requests.id` is FK'd from `portal_tasks`
 * `ON DELETE RESTRICT`), but this precheck is what turns a constraint
 * violation into the organizer-facing copy the work order requires, rather
 * than a raw 500 (analysis trap #20).
 */
export async function deleteFileRequestIn(dbOrTx: DbOrTx, eventId: EventId, id: string): Promise<void> {
  const inUse = await dbOrTx.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM portal_tasks WHERE event_id = ${eventId} AND file_request_id = ${id}
  `);
  if (Number((inUse.rows ?? [])[0]?.n ?? 0) > 0) {
    throw new AppError("CONFLICT", "This form/file request is used by a task. Revert the task to Manual first.");
  }
  const result = await dbOrTx.execute<{ id: string }>(sql`
    DELETE FROM file_requests WHERE id = ${id} AND event_id = ${eventId} RETURNING id
  `);
  if ((result.rows ?? []).length === 0) throw new AppError("NOT_FOUND", "File request not found");
}

export const saveTask = (eventId: EventId, input: SaveTaskInput) => saveTaskIn(db, eventId, input);
export const createTask = (eventId: EventId, input: SaveTaskInput) => createTaskIn(db, eventId, input);
export const deleteTask = (eventId: EventId, taskId: TaskId) => deleteTaskIn(db, eventId, taskId);
export const reopenCompletion = (eventId: EventId, taskId: TaskId, contactId: ContactId, submissionId: SubmissionId | null) =>
  reopenCompletionIn(db, eventId, taskId, contactId, submissionId);
export const saveFileRequest = (eventId: EventId, input: SaveFileRequestInput) => saveFileRequestIn(db, eventId, input);
export const createFileRequest = (eventId: EventId, input: SaveFileRequestInput) => createFileRequestIn(db, eventId, input);
export const deleteFileRequest = (eventId: EventId, id: string) => deleteFileRequestIn(db, eventId, id);
