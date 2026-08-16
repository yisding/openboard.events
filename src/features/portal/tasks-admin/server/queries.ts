import { and, eq, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { events, forms } from "@/db/schema";
import { requireAdmin } from "@/features/auth/index.server";
import {
  eventIdSchema,
  taskAssignmentDtoSchema,
  taskDtoSchema,
  type CompletionVia,
  type EventId,
  type TaskDTO,
  type TaskId,
  type TaskMode,
  type TaskTarget,
} from "@/shared/contracts";
import type { HandlerGuard } from "@/shared/server/handler";

/**
 * Organizer-only, event-scoped by the event id carried on the query string —
 * these routes have no `[eventId]` path segment, so the guard reads it the
 * same way `formBuilderAuth` does. `role` defaults to "organizer": task
 * administration is an organizer's job, same bar as the form builder and
 * evaluation rounds, not something a reviewer role can reach.
 */
export const tasksAdminAuth = (options?: { role?: "owner" | "organizer" | "reviewer" }): HandlerGuard => async (request) => {
  const eventId = eventIdSchema.parse(request.nextUrl.searchParams.get("eventId"));
  const session = await requireAdmin(eventId, options?.role ?? "organizer");
  return { actorId: session.userId, role: session.role, eventId };
};

type TaskRow = {
  id: string;
  name: string;
  description_html: string;
  target_type: TaskTarget;
  completion_mode: TaskMode;
  form_id: string | null;
  file_request_id: string | null;
  due_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

/**
 * Round-tripped through the contract schema rather than assembled by hand: the
 * schema's `superRefine` is the same mode/attachment pairing the DB CHECK
 * enforces, so a row that ever drifted from it fails loudly here instead of
 * reaching a card the organizer cannot make sense of.
 */
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
    updatedAt: new Date(row.updated_at).toISOString(),
  });
}

/**
 * `completed`/`open`/`overdue` are the assignment-progress numbers the card
 * renders, and they come from `task_assignments_v` — which drops inactive tasks
 * and non-accepted submissions, deliberately, because an inactive task assigns
 * nobody.
 *
 * `recorded` is a plain count of `task_completions` rows, which is what the
 * server's shape-change lock actually tests. Without it the editor derived
 * `locked` from `completed`, so deactivating a task with completions dropped
 * that to 0, unlocked the target and mode controls, and let an organizer fill
 * the whole form in before the save came back FORM_LOCKED — the exact outcome
 * the lock's own comment says the disabled controls exist to prevent.
 */
export type TaskCounts = { completed: number; open: number; overdue: number; recorded: number };

/**
 * `TaskDTO` plus the per-task assignment counts the admin cards show. Named
 * distinctly from the contract type on purpose — same reasoning as portal
 * task-runtime's `MyTaskDTO`: a feature-local superset, never a second
 * `TaskDTO` definition, and callers that only want the contract shape still
 * get it structurally.
 */
export type AdminTaskDTO = TaskDTO & { counts: TaskCounts };

export type TaskFilters = { targetType?: TaskTarget | "all" | undefined; search?: string | undefined };

/**
 * Every count here comes from `task_assignments_v` (resolution #14) — never
 * re-derived from `submission_participants`/`accepted_speakers_v` directly.
 * The dashboard (M38) and the portal (M25) read the same view, so their counts
 * and this admin list's counts can never disagree.
 */
export async function listTasksIn(dbOrTx: DbOrTx, eventId: EventId, filters: TaskFilters = {}): Promise<AdminTaskDTO[]> {
  const targetType = filters.targetType && filters.targetType !== "all" ? filters.targetType : null;
  const search = filters.search?.trim() || null;
  const result = await dbOrTx.execute<TaskRow & { completed_count: number; open_count: number; overdue_count: number; recorded_count: number }>(sql`
    SELECT t.id, t.name, t.description_html, t.target_type, t.completion_mode, t.form_id, t.file_request_id,
           t.due_at, t.is_active, t.created_at, t.updated_at,
           count(v.contact_id) FILTER (WHERE v.completed) AS completed_count,
           count(v.contact_id) FILTER (WHERE NOT v.completed) AS open_count,
           count(v.contact_id) FILTER (WHERE v.overdue) AS overdue_count,
           (SELECT count(*)::int FROM task_completions tc WHERE tc.task_id = t.id AND tc.event_id = t.event_id) AS recorded_count
    FROM portal_tasks t
    LEFT JOIN task_assignments_v v ON v.task_id = t.id AND v.event_id = t.event_id
    WHERE t.event_id = ${eventId}
      AND (${targetType}::task_target IS NULL OR t.target_type = ${targetType}::task_target)
      AND (${search}::text IS NULL OR t.name ILIKE '%' || ${search} || '%')
    GROUP BY t.id
    ORDER BY t.sort_order, t.created_at
  `);
  return (result.rows ?? []).map((row) => ({
    ...toTaskDto(row),
    counts: {
      completed: Number(row.completed_count),
      open: Number(row.open_count),
      overdue: Number(row.overdue_count),
      recorded: Number(row.recorded_count),
    },
  }));
}

/** Tab counts are a plain count of `portal_tasks` rows, not of assignments — "n tasks", not "n outstanding". Group is never built (speaker-portal is speakers-only), so it is always 0, never hidden (analysis trap #10). */
export type TaskTabCounts = { all: number; contact: number; group: number; submission: number };

export async function getTaskTabCountsIn(dbOrTx: DbOrTx, eventId: EventId): Promise<TaskTabCounts> {
  const result = await dbOrTx.execute<{ target_type: TaskTarget; n: number }>(sql`
    SELECT target_type, count(*)::int AS n FROM portal_tasks WHERE event_id = ${eventId} GROUP BY target_type
  `);
  const byType = new Map((result.rows ?? []).map((row) => [row.target_type, Number(row.n)]));
  const contact = byType.get("contact") ?? 0;
  const submission = byType.get("submission") ?? 0;
  return { all: contact + submission, contact, group: 0, submission };
}

export async function getTaskIn(dbOrTx: DbOrTx, eventId: EventId, taskId: TaskId): Promise<TaskDTO | null> {
  const result = await dbOrTx.execute<TaskRow>(sql`
    SELECT id, name, description_html, target_type, completion_mode, form_id, file_request_id, due_at, is_active, created_at, updated_at
    FROM portal_tasks WHERE id = ${taskId} AND event_id = ${eventId}
  `);
  const row = (result.rows ?? [])[0];
  return row ? toTaskDto(row) : null;
}

/** `TaskAssignmentDTO` plus who the row is — the matrix's whole point is naming names. */
export type AdminTaskAssignmentDTO = ReturnType<typeof taskAssignmentDtoSchema.parse> & {
  contactName: string;
  contactEmail: string;
  submissionCode: number | null;
  submissionTitle: string | null;
};

/**
 * One row per `task_assignments_v` row for this task — the fan-out rule
 * (resolution #14) decided how many rows exist before this query ever runs.
 * This module only joins in display columns; it never adds or drops a row.
 */
export async function getTaskCompletionMatrixIn(dbOrTx: DbOrTx, eventId: EventId, taskId: TaskId): Promise<AdminTaskAssignmentDTO[]> {
  const result = await dbOrTx.execute<{
    task_id: string; contact_id: string; submission_id: string | null; due_at: string | null;
    completed: boolean; completed_at: string | null; completed_via: CompletionVia | null; overdue: boolean;
    contact_name: string; contact_email: string; submission_code: number | null; submission_title: string | null;
  }>(sql`
    SELECT v.task_id, v.contact_id, v.submission_id, v.due_at, v.completed, v.completed_at, v.completed_via, v.overdue,
           nullif(btrim(c.first_name || ' ' || c.last_name), '') AS contact_name, c.email AS contact_email,
           s.code AS submission_code, s.title AS submission_title
    FROM (
      SELECT task_id, event_id, contact_id, submission_id, due_at, completed, completed_at, completed_via, overdue
      FROM task_assignments_v
      WHERE event_id = ${eventId} AND task_id = ${taskId}
      UNION ALL
      -- A completion whose assignment row no longer exists. The view resolves
      -- one contact per accepted submission via ORDER BY is_primary DESC,
      -- sort_order, id LIMIT 1, and its LEFT JOIN silently drops a completion
      -- by a contact who is no longer that one — so marking someone else primary
      -- made an existing completion vanish from this drawer while
      -- recorded_count, a raw table count, still refused every shape change
      -- with "This task has completions". Nothing in the UI could reach the row
      -- doing the locking, and reopenCompletionIn is only reachable from here.
      SELECT tc.task_id, tc.event_id, tc.contact_id, tc.submission_id,
             NULL::timestamptz AS due_at, true AS completed, tc.completed_at, tc.completed_via,
             false AS overdue
      FROM task_completions tc
      WHERE tc.event_id = ${eventId} AND tc.task_id = ${taskId}
        AND NOT EXISTS (
          SELECT 1 FROM task_assignments_v live
          WHERE live.event_id = tc.event_id AND live.task_id = tc.task_id
            AND live.contact_id = tc.contact_id
            AND live.submission_id IS NOT DISTINCT FROM tc.submission_id
        )
    ) v
    JOIN contacts c ON c.id = v.contact_id AND c.event_id = v.event_id
    LEFT JOIN submissions s ON s.id = v.submission_id AND s.event_id = v.event_id
    ORDER BY v.completed, s.code NULLS FIRST, contact_name NULLS LAST
  `);
  return (result.rows ?? []).map((row) => {
    const base = taskAssignmentDtoSchema.parse({
      taskId: row.task_id,
      contactId: row.contact_id,
      submissionId: row.submission_id,
      dueAt: row.due_at ? new Date(row.due_at).toISOString() : null,
      completed: row.completed,
      completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
      completedVia: row.completed_via,
      overdue: row.overdue,
    });
    return {
      ...base,
      contactName: row.contact_name ?? row.contact_email,
      contactEmail: row.contact_email,
      submissionCode: row.submission_code === null ? null : Number(row.submission_code),
      submissionTitle: row.submission_title,
    };
  });
}

type FileRequestRow = {
  id: string;
  title: string;
  target_type: TaskTarget;
  instructions_html: string | null;
  accepted_extensions: string[];
  max_size_mb: number;
  created_at: string;
  updated_at: string;
};

export type FileRequestDTO = {
  id: string;
  title: string;
  targetType: TaskTarget;
  instructionsHtml: string;
  acceptedExtensions: string[];
  maxSizeMb: number;
  createdAt: string;
  updatedAt: string;
};

function toFileRequestDto(row: FileRequestRow): FileRequestDTO {
  return {
    id: row.id,
    title: row.title,
    targetType: row.target_type,
    instructionsHtml: row.instructions_html ?? "",
    acceptedExtensions: row.accepted_extensions ?? [],
    maxSizeMb: Number(row.max_size_mb),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function listFileRequestsIn(dbOrTx: DbOrTx, eventId: EventId): Promise<FileRequestDTO[]> {
  const result = await dbOrTx.execute<FileRequestRow>(sql`
    SELECT id, title, target_type, instructions_html, accepted_extensions, max_size_mb, created_at, updated_at
    FROM file_requests WHERE event_id = ${eventId} ORDER BY title
  `);
  return (result.rows ?? []).map(toFileRequestDto);
}

export async function getFileRequestIn(dbOrTx: DbOrTx, eventId: EventId, id: string): Promise<FileRequestDTO | null> {
  const result = await dbOrTx.execute<FileRequestRow>(sql`
    SELECT id, title, target_type, instructions_html, accepted_extensions, max_size_mb, created_at, updated_at
    FROM file_requests WHERE id = ${id} AND event_id = ${eventId}
  `);
  const row = (result.rows ?? [])[0];
  return row ? toFileRequestDto(row) : null;
}

export type FormOption = { id: string; internalName: string };

/**
 * Only `context = 'portal'` forms — a task's `form_id` is meant for a form a
 * speaker fills out from their task list, never the CFP itself.
 */
export async function listPortalFormsIn(dbOrTx: DbOrTx, eventId: EventId): Promise<FormOption[]> {
  const rows = await dbOrTx.select({ id: forms.id, internalName: forms.internalName })
    .from(forms)
    .where(and(eq(forms.eventId, eventId), eq(forms.context, "portal")))
    .orderBy(forms.internalName);
  return rows.map((row) => ({ id: row.id, internalName: row.internalName }));
}

export async function getEventTimezoneIn(dbOrTx: DbOrTx, eventId: EventId): Promise<string> {
  const [row] = await dbOrTx.select({ timezone: events.timezone }).from(events).where(eq(events.id, eventId)).limit(1);
  return row?.timezone ?? "America/Los_Angeles";
}

export const listTasks = (eventId: EventId, filters?: TaskFilters) => listTasksIn(db, eventId, filters);
export const getTaskTabCounts = (eventId: EventId) => getTaskTabCountsIn(db, eventId);
export const getTask = (eventId: EventId, taskId: TaskId) => getTaskIn(db, eventId, taskId);
export const getTaskCompletionMatrix = (eventId: EventId, taskId: TaskId) => getTaskCompletionMatrixIn(db, eventId, taskId);
export const listFileRequests = (eventId: EventId) => listFileRequestsIn(db, eventId);
export const getFileRequest = (eventId: EventId, id: string) => getFileRequestIn(db, eventId, id);
export const listPortalForms = (eventId: EventId) => listPortalFormsIn(db, eventId);
export const getEventTimezone = (eventId: EventId) => getEventTimezoneIn(db, eventId);
