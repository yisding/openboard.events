import { and, eq, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { contacts } from "@/db/schema";
import { getCurrentSnapshotIn } from "@/features/forms";
import {
  cleanAnswersSchema,
  formSnapshotSchema,
  type AnswerValue,
  type ContactId,
  type EventId,
  type FormId,
  type FormSnapshot,
} from "@/shared/contracts";

/**
 * What a speaker still owes the organizers.
 *
 * Everything reads `task_assignments_v`, which already encodes the fan-out law:
 * contact-targeted tasks land once per accepted speaker, submission-targeted
 * tasks once per accepted submission on its primary contact. This module never
 * re-derives that — a second copy of the rule is how two surfaces start
 * disagreeing about how much work is left.
 *
 * `overdue` is the view's own boolean, computed in SQL against the database
 * clock. Recomputing it here would make a task's urgency depend on how wrong the
 * speaker's laptop clock is.
 */

/**
 * NAME: `MyTaskDTO`, deliberately not `TaskAssignmentDTO` — that is contracts'
 * 1:1 mirror of the view, and two exported types of one name would collide at
 * every import site.
 */
export type MyTaskDTO = {
  taskId: string;
  taskName: string;
  descriptionHtml: string | null;
  completionMode: "manual" | "form" | "file_request";
  targetType: "contact" | "submission";
  /** Null for contact-targeted rows. */
  submissionId: string | null;
  submissionCode: number | null;
  submissionTitle: string | null;
  /** ISO UTC; render through `<TzTime>`, never `Date` math. */
  dueAt: string | null;
  completed: boolean;
  completedAt: string | null;
  overdue: boolean;
};

/** The detail page's extra baggage: what the task points at, and what has been sent already. */
export type MyTaskDetail = MyTaskDTO & {
  formId: string | null;
  fileRequest: {
    id: string;
    title: string;
    instructionsHtml: string | null;
    acceptedExtensions: string[];
    maxSizeMb: number;
  } | null;
  uploads: Array<{ fileUploadId: string; fileAssetId: string; filename: string; createdAt: string }>;
};

type TaskRow = {
  task_id: string; task_name: string; description_html: string | null;
  completion_mode: MyTaskDTO["completionMode"]; target_type: MyTaskDTO["targetType"];
  submission_id: string | null; submission_code: number | null; submission_title: string | null;
  due_at: string | null; completed: boolean; completed_at: string | null; overdue: boolean;
  form_id: string | null; file_request_id: string | null;
};

function toTask(row: TaskRow): MyTaskDTO {
  return {
    taskId: row.task_id,
    taskName: row.task_name,
    descriptionHtml: row.description_html,
    completionMode: row.completion_mode,
    targetType: row.target_type,
    submissionId: row.submission_id,
    submissionCode: row.submission_code === null ? null : Number(row.submission_code),
    submissionTitle: row.submission_title,
    dueAt: row.due_at ? new Date(row.due_at).toISOString() : null,
    completed: row.completed,
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    overdue: row.overdue,
  };
}

const TASK_SELECT = sql`
  SELECT v.task_id, t.name AS task_name, nullif(t.description_html, '') AS description_html,
         t.completion_mode, t.target_type, t.form_id, t.file_request_id,
         v.submission_id, s.code AS submission_code, s.title AS submission_title,
         v.due_at, v.completed, v.completed_at, v.overdue
  FROM task_assignments_v v
  JOIN portal_tasks t ON t.id = v.task_id AND t.event_id = v.event_id
  LEFT JOIN submissions s ON s.id = v.submission_id AND s.event_id = v.event_id
`;

export async function listMyTasksIn(dbOrTx: DbOrTx, eventId: EventId, contactId: ContactId): Promise<MyTaskDTO[]> {
  const result = await dbOrTx.execute<TaskRow>(sql`
    ${TASK_SELECT}
    WHERE v.event_id = ${eventId} AND v.contact_id = ${contactId}
    -- Open work first, then by deadline: a speaker opening the portal should see
    -- what is due, not what they finished last week.
    ORDER BY v.completed, v.due_at ASC NULLS LAST, t.sort_order, s.code NULLS FIRST
  `);
  return (result.rows ?? []).map(toTask);
}

/**
 * One assignment, addressed the way the speaker's URL addresses it. The same
 * task id can have several independent rows — one per accepted submission — so
 * `submissionId` is part of the key, not a detail.
 *
 * Returns null rather than throwing: an assignment that is not this speaker's
 * has to be indistinguishable from one that does not exist.
 */
export async function getMyTaskIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  contactId: ContactId,
  taskId: string,
  submissionId: string | null,
): Promise<MyTaskDetail | null> {
  const result = await dbOrTx.execute<TaskRow>(sql`
    ${TASK_SELECT}
    WHERE v.event_id = ${eventId} AND v.contact_id = ${contactId} AND v.task_id = ${taskId}
      AND v.submission_id IS NOT DISTINCT FROM ${submissionId}
  `);
  const row = (result.rows ?? [])[0];
  if (!row) return null;

  let fileRequest: MyTaskDetail["fileRequest"] = null;
  let uploads: MyTaskDetail["uploads"] = [];
  if (row.file_request_id) {
    const requestRows = await dbOrTx.execute<{
      id: string; title: string; instructions_html: string | null;
      accepted_extensions: string[]; max_size_mb: number;
    }>(sql`
      SELECT id, title, nullif(instructions_html, '') AS instructions_html, accepted_extensions, max_size_mb
      FROM file_requests WHERE id = ${row.file_request_id} AND event_id = ${eventId}
    `);
    const request = (requestRows.rows ?? [])[0];
    if (request) {
      fileRequest = {
        id: request.id,
        title: request.title,
        instructionsHtml: request.instructions_html,
        acceptedExtensions: request.accepted_extensions ?? [],
        maxSizeMb: Number(request.max_size_mb),
      };
    }

    // Every upload is kept and the latest is shown; "replace" means send another
    // one, so a speaker can never destroy the file the organizers already have.
    const uploadRows = await dbOrTx.execute<{ id: string; file_asset_id: string; filename: string; created_at: string }>(sql`
      SELECT u.id, u.file_asset_id, f.filename, u.created_at
      FROM file_uploads u
      JOIN file_assets f ON f.id = u.file_asset_id AND f.event_id = u.event_id
      WHERE u.event_id = ${eventId} AND u.file_request_id = ${row.file_request_id}
        AND u.contact_id = ${contactId} AND u.submission_id IS NOT DISTINCT FROM ${submissionId}
      ORDER BY u.created_at DESC
    `);
    uploads = (uploadRows.rows ?? []).map((upload) => ({
      fileUploadId: upload.id,
      fileAssetId: upload.file_asset_id,
      filename: upload.filename,
      createdAt: new Date(upload.created_at).toISOString(),
    }));
  }

  return { ...toTask(row), formId: row.form_id, fileRequest, uploads };
}

/**
 * A form task, ready to render: the form's current snapshot plus the answers to
 * start from. Prefill comes from the columns the questions map to, so "Update
 * your details" genuinely shows the details on file rather than an empty form
 * the speaker has to retype; a previous response then overlays it, because what
 * they last said is more current than what was derived.
 */
export async function getTaskFormIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  contactId: ContactId,
  formId: string,
  submissionId: string | null,
): Promise<{ snapshot: FormSnapshot; answers: Record<string, AnswerValue> }> {
  const snapshot = await getCurrentSnapshotIn(dbOrTx, eventId, formId as FormId);

  const [contactRow] = await dbOrTx
    .select({
      firstName: contacts.firstName, lastName: contacts.lastName, email: contacts.email,
      bioHtml: contacts.bioHtml, company: contacts.company, jobTitle: contacts.jobTitle,
    })
    .from(contacts)
    .where(and(eq(contacts.id, contactId), eq(contacts.eventId, eventId)))
    .limit(1);

  const submissionRow = submissionId
    ? (await dbOrTx.execute<{ title: string; description_html: string | null; track_id: string | null; format_id: string | null; level: string | null }>(sql`
        SELECT title, description_html, track_id, format_id, level
        FROM submissions WHERE id = ${submissionId} AND event_id = ${eventId}
      `)).rows?.[0]
    : undefined;

  const text = (value: string | null | undefined): AnswerValue | undefined =>
    value === null || value === undefined || value === "" ? undefined : { t: "s", v: value };

  const answers: Record<string, AnswerValue> = {};
  for (const field of snapshot.sections.flatMap((section) => section.fields)) {
    let value: AnswerValue | undefined;
    switch (field.mapsTo) {
      case "contact.first_name": value = text(contactRow?.firstName); break;
      case "contact.last_name": value = text(contactRow?.lastName); break;
      case "contact.email": value = text(contactRow?.email); break;
      case "contact.bio_html": value = text(contactRow?.bioHtml); break;
      case "contact.company": value = text(contactRow?.company); break;
      case "contact.job_title": value = text(contactRow?.jobTitle); break;
      case "submission.title": value = text(submissionRow?.title); break;
      case "submission.description_html": value = text(submissionRow?.description_html); break;
      case "submission.level": value = text(submissionRow?.level); break;
      // A dropdown answer is an option id, not the vocabulary id stored on the
      // row, so the prefill has to come back through the option that carries it.
      case "submission.track_id": {
        const option = field.options.find((entry) => entry.trackId && entry.trackId === submissionRow?.track_id);
        value = option ? { t: "opt", v: option.id } : undefined;
        break;
      }
      case "submission.format_id": {
        const option = field.options.find((entry) => entry.formatId && entry.formatId === submissionRow?.format_id);
        value = option ? { t: "opt", v: option.id } : undefined;
        break;
      }
      default: value = undefined;
    }
    if (value) answers[field.id] = value;
  }

  const saved = (await dbOrTx.execute<{ answers: unknown }>(sql`
    SELECT answers FROM form_responses
    WHERE event_id = ${eventId} AND form_id = ${formId} AND contact_id = ${contactId}
      AND submission_id IS NOT DISTINCT FROM ${submissionId}
  `)).rows?.[0];
  if (saved) {
    for (const answer of cleanAnswersSchema.parse(saved.answers)) {
      answers[answer.fieldId] = answer.value;
    }
  }

  return { snapshot, answers };
}

/**
 * Who has completed a task and what they sent — the organizer's side, read-only.
 * One row per completion, so a task with two accepted submissions behind it
 * shows both.
 */
export type TaskCompletionRow = {
  contactId: string;
  contactName: string;
  submissionId: string | null;
  submissionCode: number | null;
  completedVia: "manual" | "form_response" | "file_upload";
  completedAt: string;
  answers: Array<{ fieldId: string; label: string; value: AnswerValue }>;
  file: { fileAssetId: string; filename: string; sizeBytes: number } | null;
};

export async function listTaskCompletionsIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  taskId: string,
): Promise<TaskCompletionRow[]> {
  const result = await dbOrTx.execute<{
    contact_id: string; contact_name: string; submission_id: string | null; submission_code: number | null;
    completed_via: TaskCompletionRow["completedVia"]; completed_at: string;
    answers: unknown; form_id: string | null; form_version: number | null;
    file_asset_id: string | null; filename: string | null; size_bytes: number | null;
  }>(sql`
    SELECT tc.contact_id, btrim(c.first_name || ' ' || c.last_name) AS contact_name,
           tc.submission_id, s.code AS submission_code, tc.completed_via, tc.completed_at,
           fr.answers, fr.form_id, fr.form_version,
           fa.id AS file_asset_id, fa.filename, fa.size_bytes
    FROM task_completions tc
    JOIN contacts c ON c.id = tc.contact_id AND c.event_id = tc.event_id
    LEFT JOIN submissions s ON s.id = tc.submission_id AND s.event_id = tc.event_id
    LEFT JOIN form_responses fr ON fr.id = tc.form_response_id AND fr.event_id = tc.event_id
    LEFT JOIN file_uploads fu ON fu.id = tc.file_upload_id AND fu.event_id = tc.event_id
    LEFT JOIN file_assets fa ON fa.id = fu.file_asset_id AND fa.event_id = tc.event_id
    WHERE tc.event_id = ${eventId} AND tc.task_id = ${taskId}
    ORDER BY tc.completed_at DESC
  `);

  const rows = result.rows ?? [];
  // Labels come from the version each response was written against, so a
  // question renamed later still reads the way its answerer saw it.
  const labels = new Map<string, Map<string, string>>();
  for (const row of rows) {
    const key = `${row.form_id}:${row.form_version}`;
    if (!row.form_id || row.form_version === null || labels.has(key)) continue;
    const snapshotRow = (await dbOrTx.execute<{ snapshot: unknown }>(sql`
      SELECT snapshot FROM form_versions
      WHERE event_id = ${eventId} AND form_id = ${row.form_id} AND version = ${row.form_version}
    `)).rows?.[0];
    if (!snapshotRow) continue;
    const snapshot = formSnapshotSchema.parse(snapshotRow.snapshot);
    labels.set(key, new Map(snapshot.sections.flatMap((section) => section.fields).map((field) => [field.id as string, field.label])));
  }

  return rows.map((row) => {
    const byField = labels.get(`${row.form_id}:${row.form_version}`);
    const answers = row.answers
      ? cleanAnswersSchema.parse(row.answers).map((answer) => ({
        fieldId: answer.fieldId as string,
        label: byField?.get(answer.fieldId as string) ?? "(question removed)",
        value: answer.value,
      }))
      : [];
    return {
      contactId: row.contact_id,
      contactName: row.contact_name,
      submissionId: row.submission_id,
      submissionCode: row.submission_code === null ? null : Number(row.submission_code),
      completedVia: row.completed_via,
      completedAt: new Date(row.completed_at).toISOString(),
      answers,
      file: row.file_asset_id && row.filename !== null
        ? { fileAssetId: row.file_asset_id, filename: row.filename, sizeBytes: Number(row.size_bytes ?? 0) }
        : null,
    };
  });
}

export const listMyTasks = (eventId: EventId, contactId: ContactId) => listMyTasksIn(db, eventId, contactId);
export const getTaskForm = (eventId: EventId, contactId: ContactId, formId: string, submissionId: string | null) =>
  getTaskFormIn(db, eventId, contactId, formId, submissionId);
export const listTaskCompletions = (eventId: EventId, taskId: string) => listTaskCompletionsIn(db, eventId, taskId);
export const getMyTask = (eventId: EventId, contactId: ContactId, taskId: string, submissionId: string | null) =>
  getMyTaskIn(db, eventId, contactId, taskId, submissionId);
