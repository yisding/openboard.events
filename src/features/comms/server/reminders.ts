import { sql } from "drizzle-orm";
import { db, withTx, type DbOrTx, type TxDb } from "@/db/client";
import { rowsOf } from "@/db/query-result";
import { communicationLogs } from "@/db/schema";
import { lockTaskAssignmentsIn } from "@/db/task-assignment-lock";
import {
  BULK_REMINDER_TARGET_LIMIT,
  idem,
  type BulkReminderResult,
  type BulkReminderTargetResult,
  type CommStatus,
  type ContactId,
  type EventId,
  type JobStats,
  type SendReminderNowResult,
  type SubmissionId,
  type TaskId,
} from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { enqueueEmail } from "@/shared/server/enqueue-email";

/**
 * The 15-minute scan. Two passes, both idempotent, both driven entirely by
 * `task_assignments_v` — no domain code ever enqueues onboarding mail, so there
 * is nothing pre-scheduled that can go stale (PLAN §2/§4 M36).
 *
 *  1. `task_assigned`: every open assignment that has never been announced.
 *     A speaker accepted long after a task was created is covered for free.
 *  2. `task_reminder`, burst-safe: per open assignment only the LATEST elapsed
 *     rung that post-dates the assignment's materialization fires; every other
 *     elapsed rung is permanently retired as a `status='skipped'` log row so it
 *     can never fire on a later tick.
 */
export type ReminderStats = JobStats & {
  scanned: number;
  assignedEnqueued: number;
  remindersEnqueued: number;
  rungsRetired: number;
};

/** Rows examined per tick. The next tick resumes wherever this one stopped. */
const ASSIGNED_BUDGET = 500;
const RUNG_BUDGET = 1000;

type AssignmentRow = {
  event_id: string;
  task_id: string;
  contact_id: string;
  submission_id: string | null;
};

type RungRow = AssignmentRow & {
  offset_days: number;
  is_fire: boolean;
};


/**
 * A cron tick is not a request handler: it acts on a whole budget of rows at
 * once (500 assignments + 1000 rungs), and `enqueueEmail` is a one-row-per-call
 * INSERT. On `neon-http` each of those is a separate subrequest, so a
 * row-at-a-time loop would spend up to 1500 of the Workers Free 50-subrequest
 * allowance on a single tick and 500 the whole scan (`defineJobRoute` would
 * return an error and the tick would be lost). Every row this module writes is
 * therefore accumulated and flushed as ONE multi-row insert per outcome —
 * queued and skipped alike — which is what the retirement path always did.
 *
 * The row shape below is `enqueueEmail`'s own, minus the branches that cannot
 * apply here: this module only ever writes `task_assigned` / `task_reminder`,
 * never `portal_login`, so there is no `secretPayloadCiphertext` to validate
 * and no `sessionId` ref. `reminders.test.ts` pins a batched row against an
 * `enqueueEmail`-written row column by column so the two cannot drift.
 */
type OutboxRow = typeof communicationLogs.$inferInsert;

function outboxRow(args: {
  eventId: EventId;
  contactId: ContactId;
  templateKey: "task_assigned" | "task_reminder";
  idempotencyKey: string;
  taskId: TaskId;
  submissionId: SubmissionId | null;
  retiredOffsetDays?: number;
}): OutboxRow {
  return {
    eventId: args.eventId,
    contactId: args.contactId,
    templateKey: args.templateKey,
    idempotencyKey: args.idempotencyKey,
    taskId: args.taskId,
    ...(args.submissionId ? { submissionId: args.submissionId } : {}),
    ...(args.retiredOffsetDays === undefined
      ? { status: "queued" as const }
      : { status: "skipped" as const, error: `superseded rung (offset ${args.retiredOffsetDays})` }),
  };
}

/**
 * The module's single write of `communication_logs` (the only non-dispatcher,
 * non-`enqueueEmail` writer the guardrails allow). `ON CONFLICT DO NOTHING` on
 * the unique idempotency key is the actual dedupe guarantee — the `NOT EXISTS`
 * pre-filters in the two SELECTs only keep the batch small.
 */
async function flushOutbox(dbOrTx: DbOrTx, rows: OutboxRow[]): Promise<void> {
  if (rows.length === 0) return;
  await dbOrTx.insert(communicationLogs).values(rows)
    .onConflictDoNothing({ target: communicationLogs.idempotencyKey });
}

function branded(row: AssignmentRow) {
  return {
    eventId: row.event_id as EventId,
    taskId: row.task_id as TaskId,
    contactId: row.contact_id as ContactId,
    submissionId: (row.submission_id ?? null) as SubmissionId | null,
  };
}

function emptyStats(): ReminderStats {
  return { scanned: 0, assignedEnqueued: 0, remindersEnqueued: 0, rungsRetired: 0 };
}

/**
 * Pass 1 — announce assignments that have no `task_assigned` log row yet.
 * The `NOT EXISTS` predicate composes the same key `idem.taskAssigned` builds;
 * it is a pre-filter only, and `enqueueEmail`'s `ON CONFLICT DO NOTHING` is the
 * actual guarantee. `reminders.test.ts` pins the two spellings together.
 */
async function scanAssignments(dbOrTx: DbOrTx, budget: number, stats: ReminderStats): Promise<void> {
  const candidates = rowsOf<AssignmentRow>(await dbOrTx.execute(sql`
    SELECT a.event_id, a.task_id, a.contact_id, a.submission_id
    FROM task_assignments_v a
    WHERE NOT a.completed
      AND NOT EXISTS (
        SELECT 1 FROM communication_logs cl
        WHERE cl.idempotency_key = a.event_id || ':task_assigned:' || a.task_id || ':' || a.contact_id
                                   || ':' || coalesce(a.submission_id::text, '-'))
    ORDER BY a.event_id, a.task_id, a.contact_id, a.submission_id
    LIMIT ${budget}
  `));
  stats.scanned += candidates.length;
  const queued = candidates.map((row) => {
    const { eventId, taskId, contactId, submissionId } = branded(row);
    return outboxRow({
      eventId,
      contactId,
      templateKey: "task_assigned",
      idempotencyKey: idem.taskAssigned(eventId, taskId, contactId, submissionId),
      taskId,
      submissionId,
    });
  });
  await flushOutbox(dbOrTx, queued);
  stats.assignedEnqueued += queued.length;
}

/**
 * Pass 2 — the rung ladder.
 *
 *  - `elapsed`   rungs whose instant has passed. Future rungs are ignored, so
 *                nothing is ever scheduled ahead of time.
 *  - `materialized_at` = greatest(task.created_at, the target's accepted_at) —
 *                the earliest instant the assignment could have existed.
 *  - `fire`      the latest elapsed rung at or after materialization, per
 *                assignment. Everything else elapsed is retired.
 *
 * Rungs that already own their key are filtered out at the end rather than
 * inside `elapsed`, so an already-sent rung can never let an older rung take
 * its place as the latest one and re-nag.
 *
 * KNOWN, ACCEPTED LIMITATION — a moved due date does not reopen the ladder.
 * A rung's identity is its OFFSET (`idem.taskReminder(…, offsetDays)`, frozen
 * at CP1), while its instant is derived from the task's current `due_at`. Once
 * an offset's key is consumed — fired or retired — it is consumed forever, so
 * if an organizer pushes a task's `due_at` out after a tick has run, the −7/−1/
 * +1 rungs of the NEW due date reuse keys that are already spent and the task
 * goes quiet. This is the same permanence that makes "skipped rows are
 * retirement, not a soft state" work, and it fails safe: the worst case is a
 * missing nag, never a duplicate or a back-dated burst. Two exits exist for an
 * organizer who needs the speaker chased on the new date — M37's "send
 * reminder now" (its own `:manual:` key namespace, deliberately outside the
 * per-rung dedupe), or creating a fresh task. `reminders.test.ts` pins the
 * behaviour so it cannot change silently; un-pinning it would require an
 * additive key builder in the frozen contracts, not a change here.
 */
async function scanRungs(dbOrTx: DbOrTx, budget: number, stats: ReminderStats): Promise<void> {
  const rungs = rowsOf<RungRow>(await dbOrTx.execute(sql`
    WITH rules AS (
      SELECT event_id, offset_days FROM reminder_rules WHERE enabled
    ),
    assign AS (
      SELECT a.event_id, a.task_id, a.contact_id, a.submission_id, a.due_at,
             greatest(t.created_at, coalesce(s.decided_at, c.first_accepted_at)) AS materialized_at
      FROM task_assignments_v a
      JOIN portal_tasks t ON t.id = a.task_id AND t.event_id = a.event_id
      LEFT JOIN submissions s ON s.id = a.submission_id AND s.event_id = a.event_id AND s.status = 'accepted'
      LEFT JOIN LATERAL (
        SELECT min(s2.decided_at) AS first_accepted_at
        FROM submissions s2
        JOIN submission_participants sp ON sp.submission_id = s2.id AND sp.event_id = s2.event_id
        WHERE sp.contact_id = a.contact_id AND s2.event_id = a.event_id AND s2.status = 'accepted'
      ) c ON true
      WHERE NOT a.completed AND a.due_at IS NOT NULL
    ),
    rungs AS (
      SELECT assign.*, r.offset_days, assign.due_at + make_interval(days => r.offset_days) AS rung_at
      FROM assign JOIN rules r ON r.event_id = assign.event_id
    ),
    elapsed AS (
      SELECT * FROM rungs WHERE rung_at <= now()
    ),
    fire AS (
      SELECT DISTINCT ON (event_id, task_id, contact_id, submission_id) *
      FROM elapsed
      WHERE rung_at >= materialized_at
      ORDER BY event_id, task_id, contact_id, submission_id, rung_at DESC
    )
    SELECT e.event_id, e.task_id, e.contact_id, e.submission_id, e.offset_days,
           (f.offset_days IS NOT NULL) AS is_fire
    FROM elapsed e
    LEFT JOIN fire f
      ON f.event_id = e.event_id AND f.task_id = e.task_id AND f.contact_id = e.contact_id
     AND f.submission_id IS NOT DISTINCT FROM e.submission_id AND f.offset_days = e.offset_days
    WHERE NOT EXISTS (
      SELECT 1 FROM communication_logs cl
      WHERE cl.idempotency_key = e.event_id || ':task_reminder:' || e.task_id || ':' || e.contact_id
                                 || ':' || coalesce(e.submission_id::text, '-') || ':' || e.offset_days)
    ORDER BY e.event_id, e.task_id, e.contact_id, e.submission_id, e.offset_days
    LIMIT ${budget}
  `));
  stats.scanned += rungs.length;

  const fired: OutboxRow[] = [];
  const retired: OutboxRow[] = [];
  for (const row of rungs) {
    const { eventId, taskId, contactId, submissionId } = branded(row);
    const offsetDays = Number(row.offset_days);
    const common = {
      eventId,
      contactId,
      templateKey: "task_reminder" as const,
      idempotencyKey: idem.taskReminder(eventId, taskId, contactId, submissionId, offsetDays),
      taskId,
      submissionId,
    };
    // A retirement is not an email — it is the rung's key being permanently
    // consumed so no later tick can fire it — but both outcomes are the same
    // row in the same table, so both ride the same batched insert.
    (row.is_fire ? fired : retired).push(
      outboxRow(row.is_fire ? common : { ...common, retiredOffsetDays: offsetDays }),
    );
  }
  await flushOutbox(dbOrTx, fired);
  stats.remindersEnqueued += fired.length;
  await flushOutbox(dbOrTx, retired);
  stats.rungsRetired += retired.length;
}

export async function scanRemindersIn(
  dbOrTx: DbOrTx,
  budgets: { assigned?: number; rungs?: number } = {},
): Promise<ReminderStats> {
  const stats = emptyStats();
  await scanAssignments(dbOrTx, clampBudget(budgets.assigned, ASSIGNED_BUDGET), stats);
  await scanRungs(dbOrTx, clampBudget(budgets.rungs, RUNG_BUDGET), stats);
  return stats;
}

function clampBudget(requested: number | undefined, fallback: number): number {
  if (requested === undefined || !Number.isFinite(requested)) return fallback;
  return Math.min(Math.max(Math.trunc(requested), 1), fallback);
}

/** Wired to the private `reminders` scheduled job (%15). */
export async function scanReminders(): Promise<JobStats> {
  return scanRemindersIn(db);
}

/** Rollout-era minute-bucket send; durable-attempt writers use the Tx-only helper below. */
export async function sendReminderNowIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  taskId: TaskId,
  contactId: ContactId,
  submissionId: SubmissionId | null,
  now: number = Date.now(),
): Promise<SendReminderNowResult> {
  const minuteBucket = Math.floor(now / 60_000);
  const idempotencyKey = idem.taskReminderManual(eventId, taskId, contactId, submissionId, minuteBucket);
  const [assignment] = rowsOf<{ completed: boolean }>(await dbOrTx.execute(sql`
    SELECT completed FROM task_assignments_v
    WHERE event_id = ${eventId} AND task_id = ${taskId} AND contact_id = ${contactId}
      AND submission_id IS NOT DISTINCT FROM ${submissionId}
    LIMIT 1
  `));
  if (!assignment || assignment.completed) return { enqueued: false };
  await enqueueEmail(dbOrTx, {
    eventId,
    templateKey: "task_reminder",
    contactId,
    idempotencyKey,
    refs: { taskId, ...(submissionId ? { submissionId } : {}) },
  });
  return { enqueued: true };
}

/** A stable-attempt writer can only accept a caller-owned transaction. */
export async function sendStableReminderAttemptIn(
  tx: TxDb,
  eventId: EventId,
  taskId: TaskId,
  contactId: ContactId,
  submissionId: SubmissionId | null,
  attemptId: string,
): Promise<SendReminderNowResult> {
  const idempotencyKey = idem.taskReminderManualAttempt(eventId, taskId, contactId, submissionId, attemptId);
  await lockTaskAssignmentsIn(tx, eventId, taskId);
  const [existing] = rowsOf<{ status: CommStatus }>(await tx.execute(sql`
    SELECT status FROM communication_logs
    WHERE idempotency_key = ${idempotencyKey}
    LIMIT 1
  `));
  if (existing) return { enqueued: existing.status === "queued", attemptStatus: existing.status };
  const [assignment] = rowsOf<{ completed: boolean }>(await tx.execute(sql`
    SELECT completed FROM task_assignments_v
    WHERE event_id = ${eventId} AND task_id = ${taskId} AND contact_id = ${contactId}
      AND submission_id IS NOT DISTINCT FROM ${submissionId}
    LIMIT 1
  `));
  if (!assignment || assignment.completed) return { enqueued: false };
  const status = await upsertManualReminderAttemptIn(
    tx, eventId, taskId, contactId, submissionId, idempotencyKey,
  );
  return status === "queued"
    ? { enqueued: true }
    : { enqueued: false, attemptStatus: status };
}

type ReminderTarget = {
  taskId: TaskId;
  contactId: ContactId;
  submissionId: SubmissionId | null;
};

async function upsertManualReminderAttemptIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  taskId: TaskId,
  contactId: ContactId,
  submissionId: SubmissionId | null,
  idempotencyKey: string,
): Promise<CommStatus> {
  const [row] = await dbOrTx.insert(communicationLogs).values({
    eventId,
    templateKey: "task_reminder",
    contactId,
    idempotencyKey,
    status: "queued",
    taskId,
    ...(submissionId ? { submissionId } : {}),
  }).onConflictDoUpdate({
    target: communicationLogs.idempotencyKey,
    // Serialize with a racing retry/dispatcher without changing authority.
    set: { idempotencyKey: sql`excluded.idempotency_key` },
  }).returning();
  if (!row) throw new AppError("INTERNAL", "Reminder attempt status was not returned");
  return row.status;
}

async function loadManualReminderAttemptStatusesIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  targets: readonly ReminderTarget[],
  attemptId: string,
): Promise<Map<string, CommStatus>> {
  const keys = targets.map((target) => idem.taskReminderManualAttempt(
    eventId, target.taskId, target.contactId, target.submissionId, attemptId,
  ));
  const rows = rowsOf<{ idempotency_key: string; status: CommStatus }>(await dbOrTx.execute(sql`
    SELECT idempotency_key, status
    FROM communication_logs
    WHERE event_id = ${eventId}
      AND idempotency_key IN (${sql.join(keys.map((key) => sql`${key}`), sql`, `)})
  `));
  return new Map(rows.map((row) => [row.idempotency_key, row.status]));
}

/** M37's per-speaker "send reminder now" button. */
export async function sendReminderNow(
  eventId: EventId,
  taskId: TaskId,
  contactId: ContactId,
  submissionId: SubmissionId | null,
  attemptId?: string,
): Promise<SendReminderNowResult> {
  return attemptId
    ? withTx((tx) => sendStableReminderAttemptIn(tx, eventId, taskId, contactId, submissionId, attemptId))
    : sendReminderNowIn(db, eventId, taskId, contactId, submissionId, Date.now());
}

export type ReminderTargetTransaction = <T>(work: (tx: TxDb) => Promise<T>) => Promise<T>;

/**
 * M52's central Files view "remind the selection" bar. The production `db`
 * handle commits each target independently on purpose: one failed row does not
 * roll back reminders already accepted for other speakers. A durable attempt
 * makes that partial boundary recoverable: one HTTP batch read classifies all
 * already-committed keys, then every missing target gets one WebSocket
 * transaction. That transaction locks the target's task-row mutex, freshly
 * re-reads the exact attempt, and only then reads assignment authority and
 * inserts. Completion and reminder writers therefore have one serialization
 * order instead of trying to reconcile independent snapshots. At the 20-target
 * cap this costs at most 21 Workers subrequests (one HTTP status read plus 20
 * WebSocket transactions); SQL statements within a WebSocket transaction are
 * not separate Workers fetch subrequests.
 */
export async function sendRemindersNowIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  targets: readonly ReminderTarget[],
  now: number = Date.now(),
  attemptId?: string,
  targetTransaction: ReminderTargetTransaction = withTx,
): Promise<BulkReminderResult> {
  if (targets.length > BULK_REMINDER_TARGET_LIMIT) {
    throw new AppError("VALIDATION", `Send reminders to up to ${BULK_REMINDER_TARGET_LIMIT} assignments at a time`);
  }
  if (targets.length === 0) return { enqueued: 0, total: 0, results: [] };

  let enqueued = 0;
  const results: BulkReminderTargetResult[] = [];
  const statusByAttemptKey = attemptId
    ? await loadManualReminderAttemptStatusesIn(dbOrTx, eventId, targets, attemptId)
    : null;
  for (const target of targets) {
    // The batch id is intentionally shared: `taskReminderManualAttempt` also
    // includes the target coordinates, so a partial retry recovers each
    // already-committed row and fills only the missing targets.
    const attemptKey = attemptId
      ? idem.taskReminderManualAttempt(eventId, target.taskId, target.contactId, target.submissionId, attemptId)
      : null;
    const prefetchedStatus = attemptKey ? statusByAttemptKey?.get(attemptKey) : undefined;
    const result = attemptId && attemptKey
      ? prefetchedStatus
        ? { enqueued: prefetchedStatus === "queued", attemptStatus: prefetchedStatus }
        : await targetTransaction((tx) => sendStableReminderAttemptIn(
          tx,
          eventId,
          target.taskId,
          target.contactId,
          target.submissionId,
          attemptId,
        ))
      : await sendReminderNowIn(
        dbOrTx,
        eventId,
        target.taskId,
        target.contactId,
        target.submissionId,
        now,
      );
    if (result.enqueued) enqueued += 1;
    results.push({
      ...target,
      enqueued: result.enqueued,
      ...(result.attemptStatus
        ? { attemptStatus: result.attemptStatus }
        : result.enqueued ? { attemptStatus: "queued" as const } : {}),
    });
  }
  return { enqueued, total: targets.length, results };
}

export function sendRemindersNow(
  eventId: EventId,
  targets: readonly ReminderTarget[],
  attemptId?: string,
): Promise<BulkReminderResult> {
  return sendRemindersNowIn(db, eventId, targets, Date.now(), attemptId);
}
