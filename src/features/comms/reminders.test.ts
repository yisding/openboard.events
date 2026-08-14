import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import {
  contactIdSchema,
  eventIdSchema,
  idem,
  submissionIdSchema,
  taskIdSchema,
  type SubmissionId,
} from "@/shared/contracts";
import { enqueueEmail } from "@/shared/server/enqueue-email";
import { scanRemindersIn, sendReminderNowIn, sendRemindersNowIn } from "./server/reminders";
import { seedDefaultTemplates } from "./server/templates";
import { nudgeOutbox } from "./server/triggers";

const migration0 = readFileSync(new URL("../../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");
// M50 is additive on top of the base schema; applying it keeps this fixture
// aligned with the columns the repository modules now read.
const migrationReviewOps = readFileSync(new URL("../../../drizzle/0004_review_operations.sql", import.meta.url), "utf8");
// M51 appended `speaker_bulk_message` to `template_key`; `seedDefaultTemplates`
// inserts a row per `TEMPLATE_KEYS` entry, so the enum needs every label a
// migration ever appended, in order, or the very first insert 22P02s.
const migrationRoster = readFileSync(new URL("../../../drizzle/0008_speaker_roster_operations.sql", import.meta.url), "utf8");
// M42 adds the admin_password_reset / admin_email_verification template keys,
// which `seedDefaultTemplates` inserts for every event.
const migrationProductAuth = readFileSync(new URL("../../../drizzle/0009_product_auth.sql", import.meta.url), "utf8");
// M43's `organizations` table, which M44's `organization_invitations`/
// `organization_audit_log` FK against; M44 appended `organization_invited` to
// `template_key`, which `seedDefaultTemplates` also inserts for every event.
const migrationTenancy = readFileSync(new URL("../../../drizzle/0010_organization_tenancy.sql", import.meta.url), "utf8");
const migrationUserManagement = readFileSync(new URL("../../../drizzle/0011_user_management.sql", import.meta.url), "utf8");

const eventId = eventIdSchema.parse("d0000000-0000-4000-8000-000000000001");
const otherEventId = eventIdSchema.parse("d0000000-0000-4000-8000-000000000002");
const speakerId = contactIdSchema.parse("d0000000-0000-4000-8000-000000000010");
const coSpeakerId = contactIdSchema.parse("d0000000-0000-4000-8000-000000000011");
const formId = "d0000000-0000-4000-8000-000000000020";
const submissionId = submissionIdSchema.parse("d0000000-0000-4000-8000-000000000030");
const taskId = taskIdSchema.parse("d0000000-0000-4000-8000-000000000040");
const secondTaskId = taskIdSchema.parse("d0000000-0000-4000-8000-000000000041");
const reminderAttemptId = "d0000000-0000-4000-8000-000000000050";
const secondReminderAttemptId = "d0000000-0000-4000-8000-000000000051";

type LogRow = { idempotency_key: string; status: string; error: string | null; task_id: string | null; submission_id: string | null; contact_id: string };

describe("reminder + assignment scan", () => {
  let pglite: PGlite;
  let tx: TxDb;

  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migration0);
    await pglite.exec(migration1);
    await pglite.exec(migrationReviewOps);
    await pglite.exec(migrationRoster);
    await pglite.exec(migrationProductAuth);
    await pglite.exec(migrationTenancy);
    await pglite.exec(migrationUserManagement);
    tx = drizzle(pglite, { schema }) as unknown as TxDb;
  });

  beforeEach(async () => {
    // Events cascade to contacts, tasks, submissions, rules and logs, so this
    // is a full reset; the scan is deliberately event-agnostic (it is a cron).
    await pglite.query("DELETE FROM events");
    for (const [id, slug] of [[eventId, "ai-engineer"], [otherEventId, "other"]] as const) {
      await pglite.query(
        "INSERT INTO events(id,name,slug,location,timezone,starts_at,ends_at) VALUES($1,'AI Engineer',$2,'Fort Mason','America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
        [id, slug],
      );
      await seedDefaultTemplates(tx, eventIdSchema.parse(id));
    }
    await pglite.query("INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES($1,$3,'speaker@example.com','Nadia','Lee'),($2,$3,'co@example.com','Sam','Ng')", [speakerId, coSpeakerId, eventId]);
    await pglite.query("INSERT INTO forms(id,event_id,context,internal_name,status) VALUES($1,$2,'cfp','Main CFP','open')", [formId, eventId]);
  });

  async function insertSubmission(status: string, options: { coSpeaker?: boolean; decidedAt?: string } = {}): Promise<void> {
    await pglite.query(
      "INSERT INTO submissions(id,event_id,form_id,form_version,code,status,title,source,submitter_contact_id,decided_at) VALUES($1,$2,$3,1,7,$4,'Agents in production','cfp',$5,$6)",
      [submissionId, eventId, formId, status, speakerId, options.decidedAt ?? null],
    );
    await pglite.query("INSERT INTO submission_participants(event_id,submission_id,contact_id,is_primary,sort_order) VALUES($1,$2,$3,true,0)", [eventId, submissionId, speakerId]);
    if (options.coSpeaker) {
      await pglite.query("INSERT INTO submission_participants(event_id,submission_id,contact_id,is_primary,sort_order) VALUES($1,$2,$3,false,1)", [eventId, submissionId, coSpeakerId]);
    }
  }

  async function insertTask(id: string, options: { targetType?: "contact" | "submission"; dueSql?: string; createdSql?: string } = {}): Promise<void> {
    const due = options.dueSql ?? "now() - interval '2 days'";
    const created = options.createdSql ?? "now() - interval '30 days'";
    await pglite.query(
      `INSERT INTO portal_tasks(id,event_id,name,target_type,completion_mode,due_at,created_at) VALUES($1,$2,'Upload your headshot',$3,'manual',${due},${created})`,
      [id, eventId, options.targetType ?? "contact"],
    );
  }

  async function logs(templateKey: string): Promise<LogRow[]> {
    const result = await pglite.query<LogRow>(
      "SELECT idempotency_key,status,error,task_id,submission_id,contact_id FROM communication_logs WHERE template_key=$1 ORDER BY idempotency_key",
      [templateKey],
    );
    return result.rows;
  }

  it("fires exactly one rung and retires the elapsed rest for an already-overdue task", async () => {
    await insertSubmission("accepted", { decidedAt: "2026-01-01T00:00:00Z" });
    await insertTask(taskId);

    const first = await scanRemindersIn(tx);
    expect(first.assignedEnqueued).toBe(1);
    expect(first.remindersEnqueued).toBe(1);
    expect(first.rungsRetired).toBe(2);
    expect(first.scanned).toBe(4);

    const reminders = await logs("task_reminder");
    expect(reminders.filter((row) => row.status === "queued")).toHaveLength(1);
    expect(reminders.filter((row) => row.status === "skipped")).toHaveLength(2);
    // The latest elapsed rung is the one that fires; older elapsed rungs retire.
    const queued = reminders.find((row) => row.status === "queued");
    expect(queued?.idempotency_key).toBe(idem.taskReminder(eventId, taskId, speakerId, null, 1));
    expect(reminders.filter((row) => row.status === "skipped").map((row) => row.error).sort())
      .toEqual(["superseded rung (offset -1)", "superseded rung (offset -7)"]);
    for (const row of reminders) expect(row.task_id).toBe(taskId);

    const second = await scanRemindersIn(tx);
    expect(second).toEqual({ scanned: 0, assignedEnqueued: 0, remindersEnqueued: 0, rungsRetired: 0 });
    expect(await logs("task_reminder")).toHaveLength(3);
    expect(await logs("task_assigned")).toHaveLength(1);
  });

  it("pins the CP3 seed fixture: BOTH backdates are load-bearing, an overdue due date is not enough", async () => {
    // The deployed-route guardrail's second precondition is "1 queued + 2
    // skipped on the first tick against a reset preview seed". That outcome is
    // NOT a property of `due_at` — it is a property of `materialized_at`,
    // i.e. greatest(portal_tasks.created_at, the speaker's decided_at). Both
    // default to the seed run's now(), and either one left at now() makes the
    // whole ladder pre-materialization: zero emails, three permanent skips,
    // however overdue the task looks.
    //
    // So the CP3 fixture needs the seed to backdate BOTH:
    //   · scripts/seed/portal.ts  — confirm-details `created_at`  (done)
    //   · scripts/seed/submissions.ts — the accepted rows' `submitted_at` /
    //     `decided_at`, which the status trigger stamps as now() (M17-owned)
    // This test is the pin that fails loudly if either backdate is dropped.
    const scanFresh = async (createdSql: string, decidedSql: string) => {
      await pglite.query("DELETE FROM communication_logs");
      await pglite.query("DELETE FROM portal_tasks");
      await pglite.query(`UPDATE submissions SET decided_at = ${decidedSql} WHERE id=$1`, [submissionId]);
      await insertTask(taskId, { dueSql: "now() - interval '2 days'", createdSql });
      return scanRemindersIn(tx);
    };
    await insertSubmission("accepted", { decidedAt: "2026-01-01T00:00:00Z" });

    // Neither backdated — what an un-fixed seed actually produces.
    expect(await scanFresh("now()", "now()")).toMatchObject({ remindersEnqueued: 0, rungsRetired: 3 });
    // Only the task backdated: the speaker still materialized this instant.
    expect(await scanFresh("now() - interval '30 days'", "now()")).toMatchObject({ remindersEnqueued: 0, rungsRetired: 3 });
    // Only the acceptance backdated: the task still materialized this instant.
    expect(await scanFresh("now()", "now() - interval '21 days'")).toMatchObject({ remindersEnqueued: 0, rungsRetired: 3 });
    // Both backdated — the CP3 fixture the guardrail promises.
    expect(await scanFresh("now() - interval '30 days'", "now() - interval '21 days'"))
      .toMatchObject({ remindersEnqueued: 1, rungsRetired: 2 });
  });

  it("writes queued rows identical to enqueueEmail's, so the batched insert cannot drift", async () => {
    // The scan batches its queued rows into one multi-row INSERT instead of one
    // `enqueueEmail` round trip per row (a 1500-subrequest tick would blow the
    // Workers Free ceiling and lose the whole scan). That batch reimplements
    // `enqueueEmail`'s row shape, so pin the two against each other.
    await insertSubmission("accepted", { decidedAt: "2026-01-01T00:00:00Z" });
    await insertTask(taskId);
    await scanRemindersIn(tx);

    await enqueueEmail(tx, {
      eventId,
      templateKey: "task_reminder",
      contactId: speakerId,
      idempotencyKey: "reference-row",
      refs: { taskId },
    });

    const { rows } = await pglite.query<Record<string, unknown>>(
      `SELECT idempotency_key, status, error, attempts, template_key, event_id, contact_id, task_id,
              submission_id, session_id, subject_rendered, body_rendered_html, secret_payload_ciphertext,
              provider_message_id, ics_uid, sent_at, locked_until
       FROM communication_logs WHERE template_key='task_reminder' AND status='queued'`,
    );
    expect(rows).toHaveLength(2);
    const reference = rows.find((row) => row.idempotency_key === "reference-row");
    const batched = rows.find((row) => row.idempotency_key !== "reference-row");
    const comparable = (row: Record<string, unknown> | undefined) =>
      Object.fromEntries(Object.entries(row ?? {}).filter(([column]) => column !== "idempotency_key"));
    expect(comparable(batched)).toEqual(comparable(reference));
  });

  it("does not reopen the ladder when the due date moves — documented, accepted", async () => {
    // Rung keys are offset-based and permanently consumed; rung instants are
    // due_at-derived. Moving due_at after a tick therefore silences the task
    // rather than re-nagging on the new date. Fails safe (a missing nag, never
    // a duplicate), and M37's `:manual:` "send reminder now" is the exit.
    await insertSubmission("accepted", { decidedAt: "2026-01-01T00:00:00Z" });
    await insertTask(taskId);
    expect((await scanRemindersIn(tx)).remindersEnqueued).toBe(1);

    await pglite.query("UPDATE portal_tasks SET due_at = now() + interval '6 days' WHERE id=$1", [taskId]);
    expect(await scanRemindersIn(tx)).toEqual({ scanned: 0, assignedEnqueued: 0, remindersEnqueued: 0, rungsRetired: 0 });

    // The organizer's escape hatch still works: a manual nudge is a separate
    // key namespace, so it is not swallowed by the spent rung keys.
    expect(await sendReminderNowIn(tx, eventId, taskId, speakerId, null)).toEqual({ enqueued: true });
  });

  it("stops scanning an assignment once the task is completed", async () => {
    await insertSubmission("accepted", { decidedAt: "2026-01-01T00:00:00Z" });
    await insertTask(taskId);
    await scanRemindersIn(tx);
    await pglite.query("DELETE FROM communication_logs");

    await pglite.query("INSERT INTO task_completions(event_id,task_id,contact_id,completed_via) VALUES($1,$2,$3,'manual')", [eventId, taskId, speakerId]);
    const stats = await scanRemindersIn(tx);
    expect(stats).toEqual({ scanned: 0, assignedEnqueued: 0, remindersEnqueued: 0, rungsRetired: 0 });
  });

  it("announces a task created before the submission was accepted on the next scan", async () => {
    await insertSubmission("pending");
    await insertTask(taskId, { dueSql: "NULL" });

    const beforeAccept = await scanRemindersIn(tx);
    expect(beforeAccept.assignedEnqueued).toBe(0);
    expect(await logs("task_assigned")).toHaveLength(0);

    await pglite.query("UPDATE submissions SET status='accepted' WHERE id=$1", [submissionId]);

    const afterAccept = await scanRemindersIn(tx);
    expect(afterAccept.assignedEnqueued).toBe(1);
    const announced = await logs("task_assigned");
    expect(announced).toHaveLength(1);
    expect(announced[0]?.idempotency_key).toBe(idem.taskAssigned(eventId, taskId, speakerId, null));

    // A NULL due date never participates in the ladder — no throw, no rungs.
    expect(afterAccept.remindersEnqueued).toBe(0);
    expect(afterAccept.rungsRetired).toBe(0);
    expect(await logs("task_reminder")).toHaveLength(0);

    const rescan = await scanRemindersIn(tx);
    expect(rescan.assignedEnqueued).toBe(0);
    expect(await logs("task_assigned")).toHaveLength(1);
  });

  it("suppresses rungs that predate the assignment's materialization", async () => {
    // Task created just now, due in six days: the −7d rung is elapsed but
    // predates the task, so nothing fires and every elapsed rung retires.
    await insertSubmission("accepted", { decidedAt: "2026-01-01T00:00:00Z" });
    await insertTask(taskId, { dueSql: "now() + interval '6 days'", createdSql: "now()" });

    const stats = await scanRemindersIn(tx);
    expect(stats.remindersEnqueued).toBe(0);
    expect(stats.rungsRetired).toBe(1);
    const reminders = await logs("task_reminder");
    expect(reminders).toHaveLength(1);
    expect(reminders[0]?.status).toBe("skipped");
    expect(reminders[0]?.error).toBe("superseded rung (offset -7)");
  });

  it("suppresses back-dated nags for a speaker accepted after the rungs elapsed", async () => {
    // Task is 30 days old and two days overdue, but the speaker was accepted an
    // hour ago: only the rung at or after the acceptance may fire, and none is.
    await insertSubmission("accepted", { decidedAt: "now" });
    await pglite.query("UPDATE submissions SET decided_at=now() - interval '1 hour' WHERE id=$1", [submissionId]);
    await insertTask(taskId);

    const stats = await scanRemindersIn(tx);
    expect(stats.remindersEnqueued).toBe(0);
    expect(stats.rungsRetired).toBe(3);
    expect((await logs("task_reminder")).every((row) => row.status === "skipped")).toBe(true);
  });

  it("drops disabled reminder rules from the ladder with no cleanup", async () => {
    await insertSubmission("accepted", { decidedAt: "2026-01-01T00:00:00Z" });
    await insertTask(taskId);
    await pglite.query("UPDATE reminder_rules SET enabled=false WHERE event_id=$1 AND offset_days=1", [eventId]);

    const stats = await scanRemindersIn(tx);
    expect(stats.remindersEnqueued).toBe(1);
    expect(stats.rungsRetired).toBe(1);
    const queued = (await logs("task_reminder")).find((row) => row.status === "queued");
    expect(queued?.idempotency_key).toBe(idem.taskReminder(eventId, taskId, speakerId, null, -1));
  });

  it("obeys the fan-out rule: a co-speakered submission task announces once, to the primary", async () => {
    await insertSubmission("accepted", { coSpeaker: true, decidedAt: "2026-01-01T00:00:00Z" });
    await insertTask(taskId, { targetType: "submission" });

    const stats = await scanRemindersIn(tx);
    expect(stats.assignedEnqueued).toBe(1);
    const announced = await logs("task_assigned");
    expect(announced).toHaveLength(1);
    expect(announced[0]?.contact_id).toBe(speakerId);
    expect(announced[0]?.submission_id).toBe(submissionId);
    expect(announced[0]?.idempotency_key).toBe(idem.taskAssigned(eventId, taskId, speakerId, submissionId));
    expect(stats.remindersEnqueued).toBe(1);
  });

  it("pins the scan's SQL key spelling to the frozen contract builders", async () => {
    await insertSubmission("accepted", { decidedAt: "2026-01-01T00:00:00Z" });
    await insertTask(taskId, { targetType: "submission" });
    const result = await pglite.query<{ assigned_key: string; reminder_key: string }>(`
      SELECT a.event_id || ':task_assigned:' || a.task_id || ':' || a.contact_id
               || ':' || coalesce(a.submission_id::text, '-') AS assigned_key,
             a.event_id || ':task_reminder:' || a.task_id || ':' || a.contact_id
               || ':' || coalesce(a.submission_id::text, '-') || ':' || (-7) AS reminder_key
      FROM task_assignments_v a LIMIT 1
    `);
    const row = result.rows[0];
    expect(row?.assigned_key).toBe(idem.taskAssigned(eventId, taskId, speakerId, submissionId));
    expect(row?.reminder_key).toBe(idem.taskReminder(eventId, taskId, speakerId, submissionId, -7));
  });

  it("keeps the per-rung keys stable so a later scan can never re-nag", async () => {
    await insertSubmission("accepted", { decidedAt: "2026-01-01T00:00:00Z" });
    await insertTask(taskId);
    await scanRemindersIn(tx);
    // The dispatcher's outcome does not free the rung: only the key matters.
    await pglite.query("UPDATE communication_logs SET status='sent',sent_at=now() WHERE status='queued'");
    const stats = await scanRemindersIn(tx);
    expect(stats).toEqual({ scanned: 0, assignedEnqueued: 0, remindersEnqueued: 0, rungsRetired: 0 });
  });

  it("respects the row budget and resumes on the next tick", async () => {
    await insertSubmission("accepted", { decidedAt: "2026-01-01T00:00:00Z" });
    await insertTask(taskId);
    await insertTask(secondTaskId);

    const first = await scanRemindersIn(tx, { assigned: 1, rungs: 1 });
    expect(first.assignedEnqueued).toBe(1);
    expect(first.scanned).toBe(2);
    const second = await scanRemindersIn(tx, { assigned: 1, rungs: 1 });
    expect(second.assignedEnqueued).toBe(1);
    let guard = 0;
    let stats = await scanRemindersIn(tx);
    while ((stats.assignedEnqueued > 0 || stats.remindersEnqueued > 0 || stats.rungsRetired > 0) && guard < 10) {
      stats = await scanRemindersIn(tx);
      guard += 1;
    }
    expect(await logs("task_assigned")).toHaveLength(2);
    const reminders = await logs("task_reminder");
    expect(reminders.filter((row) => row.status === "queued")).toHaveLength(2);
    expect(reminders.filter((row) => row.status === "skipped")).toHaveLength(4);
  });

  describe("sendReminderNow", () => {
    beforeEach(async () => {
      await insertSubmission("accepted", { decidedAt: "2026-01-01T00:00:00Z" });
      await insertTask(taskId);
    });

    it("retains minute-bucket idempotency for rollout-era clients", async () => {
      const minute = 1_770_000_000_000;
      expect(await sendReminderNowIn(tx, eventId, taskId, speakerId, null, minute)).toEqual({ enqueued: true });
      expect(await sendReminderNowIn(tx, eventId, taskId, speakerId, null, minute + 5_000)).toEqual({ enqueued: true });
      expect(await logs("task_reminder")).toHaveLength(1);

      await sendReminderNowIn(tx, eventId, taskId, speakerId, null, minute + 61_000);
      const rows = await logs("task_reminder");
      expect(rows).toHaveLength(2);
      expect(rows.every((row) => row.idempotency_key.includes(":manual:"))).toBe(true);
    });

    it("replays one durable attempt after a minute without duplicating its outbox/log row", async () => {
      const firstRequestAt = 1_770_000_000_000;
      expect(await sendReminderNowIn(
        tx,
        eventId,
        taskId,
        speakerId,
        null,
        firstRequestAt,
        reminderAttemptId,
      )).toEqual({ enqueued: true });

      // The first response can be lost and the speaker can finish before the
      // retry. The existing durable attempt remains the authoritative outcome.
      await pglite.query(
        "INSERT INTO task_completions(event_id,task_id,contact_id,completed_via) VALUES($1,$2,$3,'manual')",
        [eventId, taskId, speakerId],
      );
      expect(await sendReminderNowIn(
        tx,
        eventId,
        taskId,
        speakerId,
        null,
        firstRequestAt + 121_000,
        reminderAttemptId,
      )).toEqual({ enqueued: true });

      const rows = await logs("task_reminder");
      expect(rows).toEqual([expect.objectContaining({
        idempotency_key: idem.taskReminderManualAttempt(eventId, taskId, speakerId, null, reminderAttemptId),
        status: "queued",
        task_id: taskId,
        contact_id: speakerId,
      })]);
    });

    it("queues a second deliberate reminder under a distinct attempt", async () => {
      const now = 1_770_000_000_000;
      await sendReminderNowIn(tx, eventId, taskId, speakerId, null, now, reminderAttemptId);
      await sendReminderNowIn(tx, eventId, taskId, speakerId, null, now, secondReminderAttemptId);

      const rows = await logs("task_reminder");
      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((row) => row.idempotency_key))).toEqual(new Set([
        idem.taskReminderManualAttempt(eventId, taskId, speakerId, null, reminderAttemptId),
        idem.taskReminderManualAttempt(eventId, taskId, speakerId, null, secondReminderAttemptId),
      ]));
    });

    it("does not collide with a scanned rung", async () => {
      await scanRemindersIn(tx);
      const before = (await logs("task_reminder")).length;
      expect(await sendReminderNowIn(tx, eventId, taskId, speakerId, null, 1_770_000_000_000)).toEqual({ enqueued: true });
      expect(await logs("task_reminder")).toHaveLength(before + 1);
    });

    it("refuses a completed or absent assignment", async () => {
      await pglite.query("INSERT INTO task_completions(event_id,task_id,contact_id,completed_via) VALUES($1,$2,$3,'manual')", [eventId, taskId, speakerId]);
      expect(await sendReminderNowIn(tx, eventId, taskId, speakerId, null, Date.now(), reminderAttemptId)).toEqual({ enqueued: false });
      expect(await sendReminderNowIn(tx, eventId, secondTaskId, speakerId, null)).toEqual({ enqueued: false });
      expect(await sendReminderNowIn(tx, eventId, taskId, speakerId, submissionId as SubmissionId)).toEqual({ enqueued: false });
      expect(await logs("task_reminder")).toHaveLength(0);
    });
  });

  // M52 — the central Files view's bulk bar.
  describe("sendRemindersNow (bulk)", () => {
    beforeEach(async () => {
      // Contact-targeted tasks assign only to `accepted_speakers_v` — both
      // targets need an accepted submission behind them (co-speaker counts).
      await insertSubmission("accepted", { coSpeaker: true, decidedAt: "2026-01-01T00:00:00Z" });
      await insertTask(taskId);
      await insertTask(secondTaskId);
    });

    it("reminds every still-open target and reports enqueued vs total", async () => {
      const result = await sendRemindersNowIn(tx, eventId, [
        { taskId, contactId: speakerId, submissionId: null },
        { taskId: secondTaskId, contactId: coSpeakerId, submissionId: null },
      ]);
      expect(result).toEqual({ enqueued: 2, total: 2 });
      expect(await logs("task_reminder")).toHaveLength(2);
    });

    it("skips an already-completed target without failing the rest of the batch", async () => {
      await pglite.query("INSERT INTO task_completions(event_id,task_id,contact_id,completed_via) VALUES($1,$2,$3,'manual')", [eventId, taskId, speakerId]);
      const result = await sendRemindersNowIn(tx, eventId, [
        { taskId, contactId: speakerId, submissionId: null },
        { taskId: secondTaskId, contactId: coSpeakerId, submissionId: null },
      ]);
      expect(result).toEqual({ enqueued: 1, total: 2 });
      const rows = await logs("task_reminder");
      expect(rows).toHaveLength(1);
      expect(rows[0]?.contact_id).toBe(coSpeakerId);
    });

    it("is the identity mapping over an empty selection", async () => {
      expect(await sendRemindersNowIn(tx, eventId, [])).toEqual({ enqueued: 0, total: 0 });
      expect(await logs("task_reminder")).toHaveLength(0);
    });
  });
});

describe("nudgeOutbox", () => {
  it("hands the drain to waitUntil and swallows a failed drain", async () => {
    const handed: Array<Promise<unknown>> = [];
    nudgeOutbox((promise) => { handed.push(promise); });
    expect(handed).toHaveLength(1);
    // No DATABASE_URL here, so the drain rejects internally; the caller must
    // never see it — the cron is the guarantee, the nudge is latency polish.
    await expect(handed[0]).resolves.toBeUndefined();
  });

  it("survives a host that has no waitUntil to hand the promise to", () => {
    expect(() => nudgeOutbox(() => { throw new Error("no cloudflare context"); })).not.toThrow();
  });
});
