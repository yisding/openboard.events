import { taskCompletions } from "@/db/schema";
import { createFileRequestIn, createTaskIn, type SaveTaskInput } from "@/features/portal";
import { eventDayKey } from "@/shared/lib/time";
import { fileRequestIdSchema, taskIdSchema, type FileRequestId, type TaskId } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { DEMO_TIMEZONE, demoLocal } from "../clock";
import { FILE_REQUESTS, OVERDUE_HOLDOUT_SPEAKER_KEY, SUBMISSIONS, TASK_DEFINITIONS } from "../dataset";
import { demoId } from "../ids";
import { demoContactId, type PhaseCtx } from "./context";

/**
 * Phase 8 — the portal, and Victor's overdue task.
 *
 * `portal_tasks.target_type` reaches its speakers through exactly two derived
 * views (verified `drizzle/0001_views_triggers.sql`, load-bearing everywhere
 * from the dashboard's overdue count to the reminder cron — `tasks-admin/
 * server/queries.ts` calls it "the fan-out law" and never re-derives it):
 * `'contact'` fans out to every row in `accepted_speakers_v` (a participant on
 * *some* accepted submission), and `'submission'` fans out one assignment per
 * accepted submission to its primary contact. **There is no writer anywhere
 * in this codebase that hands a task to an individually chosen contact.**
 *
 * Two consequences follow, both real deviations from the design's dataset
 * (`dataset.ts`'s `TASK_ASSIGNMENTS`, which names two hand-picked speakers per
 * task) and both recorded in WP5's report:
 *
 * 1. Every task here is `target_type: 'contact'` — every accepted speaker owes
 *    every task, not the two named in the dataset. This is *more* consistent
 *    with "eighteen of eighteen speakers missing a headshot" than a narrow
 *    two-person assignment would have been.
 * 2. The dataset's overdue protagonist, Dana Whitfield, can never be a real
 *    `task_assignments_v` row: her only submission (`draft-dana-untitled`) is
 *    a draft, and `accepted_speakers_v` is built from `status = 'accepted'`
 *    participants only. `OVERDUE_HOLDOUT_SPEAKER_KEY` substitutes Victor Achebe
 *    — an accepted speaker who is also one of the dataset's own three named
 *    `travel-form` assignees — as the sole holdout Chapter 6 finds overdue.
 *    Every other accepted speaker's `travel-form` is marked done directly
 *    (`task_completions`, `completed_via: 'admin'`) so exactly one assignment
 *    stays outstanding event-wide, matching the "exactly one overdue
 *    assignment" invariant this phase's own tests hold it to.
 *
 * A second, smaller deviation: `TASK_DEFINITIONS` declares `headshot` as
 * `completion_mode: 'file_request'` and `travel-form` as `'form'`, but the
 * dataset's one `file_requests` row is scoped to `slides` and neither CFP form
 * is a portal-context intake form a task could point `formId` at. Both are
 * realized here as `'manual'` instead — schema-valid, and it keeps this phase
 * from minting a `file_requests`/`forms` row `DATASET_MANIFEST` does not
 * expect. The real headshot upload the tour cares about (Chapter 6, "uploading
 * a headshot... exercises the real R2 presign path", design §2.4) happens
 * through the speaker's own profile edit — `contacts.headshot_file_id` — never
 * through this task at all, which is why the field trip's objective already
 * accepts `contactsUpdatedAt changed` as an alternative to a task completion.
 *
 * Every writer here (`createTaskIn`, `createFileRequestIn`) is typed against
 * `DbOrTx`, not a transaction runner, so — like phase 7 — this phase writes
 * directly through `ctx.dbOrTx`.
 */

const COMPLETION_MODE_OVERRIDE: Readonly<Partial<Record<string, SaveTaskInput["completionMode"]>>> = {
  headshot: "manual",
  "travel-form": "manual",
};

/** Re-exported from the dataset so the tour script and this phase can never
 *  name two different people (see `OVERDUE_HOLDOUT_SPEAKER_KEY`). */
const OVERDUE_HOLDOUT_KEY = OVERDUE_HOLDOUT_SPEAKER_KEY;

/** Every speaker who is a participant on at least one `accepted` submission —
 *  the exact set `accepted_speakers_v` computes once these rows are
 *  committed, kept here as a pure function of the dataset so this phase does
 *  not have to round-trip the view to know who its own writes will reach. */
const ACCEPTED_SPEAKER_KEYS: readonly string[] = [...new Set(
  SUBMISSIONS
    .filter((submission) => submission.status === "accepted")
    .flatMap((submission) => submission.participants.map((participant) => participant.speakerKey)),
)];

function dueDateOnly(now: Date, offsetDays: number): string {
  return eventDayKey(demoLocal(now, offsetDays, "17:00"), DEMO_TIMEZONE);
}

export async function runPortalPhase(ctx: PhaseCtx): Promise<void> {
  const { dbOrTx, eventId, now } = ctx;

  const fileRequestIds = new Map<string, FileRequestId>();
  for (const request of FILE_REQUESTS) {
    const fileRequestId = fileRequestIdSchema.parse(demoId(eventId, `file-request:${request.key}`));
    await createFileRequestIn(dbOrTx, eventId, {
      id: fileRequestId,
      title: request.title,
      targetType: "contact",
      instructionsHtml: request.instructionsHtml,
      acceptedExtensions: [...request.acceptedExtensions],
      maxSizeMb: request.maxSizeMb,
    });
    fileRequestIds.set(request.taskKey, fileRequestId);
  }

  const taskIds = new Map<string, TaskId>();
  for (const definition of TASK_DEFINITIONS) {
    const taskId = taskIdSchema.parse(demoId(eventId, `task:${definition.key}`));
    const completionMode = COMPLETION_MODE_OVERRIDE[definition.key] ?? definition.completionMode;
    await createTaskIn(dbOrTx, eventId, {
      id: taskId,
      name: definition.name,
      descriptionHtml: definition.descriptionHtml,
      targetType: "contact",
      completionMode,
      formId: null,
      fileRequestId: completionMode === "file_request" ? (fileRequestIds.get(definition.key) ?? null) : null,
      dueAt: dueDateOnly(now, definition.dueOffsetDays),
      isActive: true,
    });
    taskIds.set(definition.key, taskId);
  }

  await settleTravelFormIn(ctx, taskIds);
}

/**
 * Marks the travel-form task done for every accepted speaker except the one
 * holdout, so `task_assignments_v.overdue` is true for exactly one row.
 * `task_completions` carries no unique constraint of its own (verified: only
 * a non-unique `(event_id, contact_id)` index — `drizzle/0000_init.sql`), so
 * idempotency here is the deterministic `demoId` on this row's own `id`,
 * `ON CONFLICT DO NOTHING`, the same discipline phase 10 uses for its log
 * rows and the design's own precedent for "the seeded row is written
 * directly because no writer for exactly this shape exists."
 */
async function settleTravelFormIn(ctx: PhaseCtx, taskIds: ReadonlyMap<string, TaskId>): Promise<void> {
  const { dbOrTx, eventId, now, actorUserId } = ctx;
  const travelFormTaskId = taskIds.get("travel-form");
  if (!travelFormTaskId) throw new AppError("INTERNAL", "The demo's travel-form task is missing");

  // A few days before the −30d due date: everyone but the holdout got it in
  // on time.
  const completedAt = demoLocal(now, -32, "10:00");
  const rows = ACCEPTED_SPEAKER_KEYS
    .filter((speakerKey) => speakerKey !== OVERDUE_HOLDOUT_KEY)
    .map((speakerKey) => ({
      id: demoId(eventId, `task-completion:travel-form:${speakerKey}`),
      eventId,
      taskId: travelFormTaskId,
      contactId: demoContactId(eventId, speakerKey),
      completedVia: "admin" as const,
      completedByUserId: actorUserId,
      completedAt,
    }));
  if (rows.length === 0) return;
  await dbOrTx.insert(taskCompletions).values(rows).onConflictDoNothing({ target: taskCompletions.id });
}
