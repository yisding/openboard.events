import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import type { DbOrTx } from "@/db/client";
import * as schema from "@/db/schema";
import { contactIdSchema, eventIdSchema, fileRequestIdSchema, submissionIdSchema, taskIdSchema } from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";
import { endOfDayInTz } from "@/shared/lib/time";
import {
  createFileRequestIn,
  createTaskIn,
  deleteFileRequestIn,
  reopenCompletionIn,
  saveFileRequestIn,
  saveFileRequestInputSchema,
  saveTaskIn,
  saveTaskInputSchema,
  updateTaskInputSchema,
} from "./server/mutations";
import { getTaskCompletionMatrixIn, getTaskTabCountsIn, listTasksIn } from "./server/queries";

const migration0 = readFileSync(new URL("../../../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");
// M50 is additive on top of the base schema; applying it keeps this fixture
// aligned with the columns the repository modules now read.
const migrationReviewOps = readFileSync(new URL("../../../../drizzle/0004_review_operations.sql", import.meta.url), "utf8");

const eventId = eventIdSchema.parse("d5000000-0000-4000-8000-000000000001");
const otherEventId = eventIdSchema.parse("d5000000-0000-4000-8000-000000000002");
const ada = contactIdSchema.parse("d5000000-0000-4000-8000-000000000010");
const grace = contactIdSchema.parse("d5000000-0000-4000-8000-000000000011");
const talkOne = submissionIdSchema.parse("d5000000-0000-4000-8000-000000000020");
const talkTwo = submissionIdSchema.parse("d5000000-0000-4000-8000-000000000021");
const pendingTalk = submissionIdSchema.parse("d5000000-0000-4000-8000-000000000022");
const lateTalk = submissionIdSchema.parse("d5000000-0000-4000-8000-000000000023");
const lateContact = contactIdSchema.parse("d5000000-0000-4000-8000-000000000012");

let pglite: PGlite;
let db: DbOrTx;

const taskInput = (overrides: Record<string, unknown> = {}) =>
  saveTaskInputSchema.parse({
    name: "Upload your slides", targetType: "submission", completionMode: "manual", isActive: true, ...overrides,
  });

async function count(table: string, where = "TRUE"): Promise<number> {
  const result = await pglite.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`);
  return result.rows[0]?.n ?? 0;
}

describe("tasks admin: database CRUD, the assignment-view counting law, and RESTRICT semantics", () => {
  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migration0);
    await pglite.exec(migration1);
    await pglite.exec(migrationReviewOps);
    db = drizzle(pglite, { schema }) as unknown as DbOrTx;

    await pglite.query(
      "INSERT INTO events(id,name,slug,starts_at,ends_at,timezone) VALUES($1,'Task Admin Event','task-admin-event','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z','America/Los_Angeles')",
      [eventId],
    );
    await pglite.query(
      "INSERT INTO events(id,name,slug,starts_at,ends_at,timezone) VALUES($1,'Other Task Event','other-task-event','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z','America/Los_Angeles')",
      [otherEventId],
    );
    await pglite.query("INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES($1,$2,'ada@example.com','Ada','Lovelace')", [ada, eventId]);
    await pglite.query("INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES($1,$2,'grace@example.com','Grace','Hopper')", [grace, eventId]);
    await pglite.query("INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES($1,$2,'late@example.com','Late','Arrival')", [lateContact, eventId]);

    for (const [id, code, title, status] of [
      [talkOne, 1, "Caching at the edge", "accepted"],
      [talkTwo, 2, "Agents that ship", "accepted"],
      [pendingTalk, 3, "Not decided yet", "pending"],
    ] as const) {
      await pglite.query(
        "INSERT INTO submissions(id,event_id,code,title,status,submitted_at) VALUES($1,$2,$3,$4,$5, now())",
        [id, eventId, code, title, status],
      );
      await pglite.query(
        "INSERT INTO submission_participants(event_id,submission_id,contact_id,is_primary,sort_order) VALUES($1,$2,$3,true,0)",
        [eventId, id, ada],
      );
    }
    // A co-speaker on talkOne — the fan-out law's whole point is that this
    // person gets no assignment of their own for a submission task.
    await pglite.query(
      "INSERT INTO submission_participants(event_id,submission_id,contact_id,is_primary,sort_order) VALUES($1,$2,$3,false,1)",
      [eventId, talkOne, grace],
    );
  }, 60_000);

  it("fan-out: a submission task materializes exactly one row per accepted submission, the primary contact only", async () => {
    const { id: taskId } = await saveTaskIn(db, eventId, taskInput());
    const matrix = await getTaskCompletionMatrixIn(db, eventId, taskId);

    // Two accepted submissions, one row each — the pending one contributes none.
    expect(matrix).toHaveLength(2);
    expect(matrix.every((row) => row.contactId === ada)).toBe(true);
    expect(matrix.some((row) => row.submissionId === pendingTalk)).toBe(false);
    // Grace co-speaks talkOne but is never primary, so she gets no row.
    expect(matrix.some((row) => row.contactId === grace)).toBe(false);

    // Zero backfill code: a submission accepted *after* the task exists still
    // shows up the moment the view is read again, because the view — not this
    // module — computes the fan-out.
    await pglite.query(
      "INSERT INTO submissions(id,event_id,code,title,status,submitted_at) VALUES($1,$2,4,'Landed after the task','accepted', now())",
      [lateTalk, eventId],
    );
    await pglite.query(
      "INSERT INTO submission_participants(event_id,submission_id,contact_id,is_primary,sort_order) VALUES($1,$2,$3,true,0)",
      [eventId, lateTalk, lateContact],
    );
    const matrixAfter = await getTaskCompletionMatrixIn(db, eventId, taskId);
    expect(matrixAfter).toHaveLength(3);
    expect(matrixAfter.some((row) => row.submissionId === lateTalk && row.contactId === lateContact)).toBe(true);
  });

  it("returns the original task and file request on create replay without touching updated_at", async () => {
    const stableTaskId = taskIdSchema.parse("d5000000-0000-4000-8000-000000000090");
    const stableRequestId = fileRequestIdSchema.parse("d5000000-0000-4000-8000-000000000091");
    const stableTask = taskInput({ id: stableTaskId, name: "Original task", descriptionHtml: "<p>Original</p>", targetType: "contact" });
    const stableRequest = saveFileRequestInputSchema.parse({
      id: stableRequestId, title: "Original files", targetType: "contact",
      instructionsHtml: "<p>Original instructions</p>", acceptedExtensions: ["pdf"], maxSizeMb: 25,
    });

    await expect(createTaskIn(db, eventId, stableTask)).resolves.toMatchObject({ id: stableTaskId, name: "Original task" });
    await expect(createFileRequestIn(db, eventId, stableRequest)).resolves.toMatchObject({ id: stableRequestId, title: "Original files" });
    const preservedTimestamp = "2020-01-02T03:04:05.000Z";
    await pglite.query("UPDATE portal_tasks SET updated_at=$2 WHERE id=$1", [stableTaskId, preservedTimestamp]);
    await pglite.query("UPDATE file_requests SET updated_at=$2 WHERE id=$1", [stableRequestId, preservedTimestamp]);

    const replayedTask = await createTaskIn(db, eventId, taskInput({
      id: stableTaskId, name: "Stale retry copy", descriptionHtml: "<p>Stale</p>", targetType: "contact", isActive: false,
    }));
    const replayedRequest = await createFileRequestIn(db, eventId, saveFileRequestInputSchema.parse({
      id: stableRequestId, title: "Stale retry files", targetType: "contact",
      instructionsHtml: "<p>Stale</p>", acceptedExtensions: ["zip"], maxSizeMb: 400,
    }));

    expect(replayedTask).toMatchObject({ id: stableTaskId, name: "Original task", descriptionHtml: "<p>Original</p>", isActive: true });
    expect(replayedTask.updatedAt).toBe(preservedTimestamp);
    expect(replayedRequest).toMatchObject({
      id: stableRequestId, title: "Original files", instructionsHtml: "<p>Original instructions</p>",
      acceptedExtensions: ["pdf"], maxSizeMb: 25,
    });
    expect(replayedRequest.updatedAt).toBe(preservedTimestamp);

    expect(await count("portal_tasks", `id = '${stableTaskId}'`)).toBe(1);
    expect(await count("file_requests", `id = '${stableRequestId}'`)).toBe(1);
    const taskRow = await pglite.query<{ name: string; updated_at: string }>("SELECT name, updated_at FROM portal_tasks WHERE id=$1", [stableTaskId]);
    const requestRow = await pglite.query<{ title: string; updated_at: string }>("SELECT title, updated_at FROM file_requests WHERE id=$1", [stableRequestId]);
    expect(taskRow.rows[0]?.name).toBe("Original task");
    expect(new Date(taskRow.rows[0]?.updated_at ?? 0).toISOString()).toBe(preservedTimestamp);
    expect(requestRow.rows[0]?.title).toBe("Original files");
    expect(new Date(requestRow.rows[0]?.updated_at ?? 0).toISOString()).toBe(preservedTimestamp);
  });

  it("creates a copied task as an assignment-free inactive draft until it is deliberately activated", async () => {
    const source = await saveTaskIn(db, eventId, taskInput({
      name: "Collect final confirmation",
      descriptionHtml: "<p>Confirm the final session details.</p>",
      dueAt: "2026-11-01",
    }));
    await pglite.query(
      "INSERT INTO task_completions(event_id,task_id,contact_id,submission_id,completed_via) VALUES($1,$2,$3,$4,'manual')",
      [eventId, source.id, ada, talkOne],
    );

    const copyId = taskIdSchema.parse("d5000000-0000-4000-8000-000000000092");
    const copyInput = taskInput({
      id: copyId,
      name: "Collect final confirmation (copy)",
      descriptionHtml: "<p>Confirm the final session details.</p>",
      dueAt: "2026-11-01",
      isActive: false,
    });
    const copy = await createTaskIn(db, eventId, copyInput);

    expect(copy).toMatchObject({
      id: copyId,
      name: "Collect final confirmation (copy)",
      descriptionHtml: "<p>Confirm the final session details.</p>",
      targetType: source.targetType,
      completionMode: source.completionMode,
      isActive: false,
    });
    expect(copy.id).not.toBe(source.id);
    expect(await getTaskCompletionMatrixIn(db, eventId, copyId)).toEqual([]);
    expect(await count("task_completions", `task_id = '${copyId}'`)).toBe(0);

    // A response-lost retry keeps both the same row id and the inactive state,
    // even if stale editor state tries to turn the copy on in the replay body.
    const replayed = await createTaskIn(db, eventId, taskInput({
      ...copyInput,
      name: "Stale retry",
      isActive: true,
    }));
    expect(replayed).toMatchObject({ id: copyId, name: "Collect final confirmation (copy)", isActive: false });
    expect(await count("portal_tasks", `id = '${copyId}'`)).toBe(1);
    expect(await getTaskCompletionMatrixIn(db, eventId, copyId)).toEqual([]);

    const activated = await saveTaskIn(db, eventId, taskInput({ ...copyInput, isActive: true }), { expectedUpdatedAt: copy.updatedAt });
    expect(activated.isActive).toBe(true);
    expect((await getTaskCompletionMatrixIn(db, eventId, copyId)).length).toBeGreaterThan(0);
  });

  it("reads counts from task_assignments_v, never re-derived", async () => {
    const { id: taskId } = await saveTaskIn(db, eventId, taskInput({ name: "Counting law task" }));
    await pglite.query(
      "INSERT INTO task_completions(event_id,task_id,contact_id,submission_id,completed_via) VALUES($1,$2,$3,$4,'manual')",
      [eventId, taskId, ada, talkOne],
    );
    const [row] = await listTasksIn(db, eventId, { search: "Counting law task" });
    expect(row?.counts.completed).toBe(1);
    expect(row?.counts.open).toBe(row ? row.counts.completed + row.counts.open - 1 : 0);
  });

  it("reopen: deletes the one completion row without touching assignment membership", async () => {
    const { id: taskId } = await saveTaskIn(db, eventId, taskInput({ name: "Reopen task" }));
    const beforeMatrix = await getTaskCompletionMatrixIn(db, eventId, taskId);
    const assignmentCount = beforeMatrix.length;

    await pglite.query(
      "INSERT INTO task_completions(event_id,task_id,contact_id,submission_id,completed_via) VALUES($1,$2,$3,$4,'manual')",
      [eventId, taskId, ada, talkOne],
    );
    expect(await count("task_completions", `task_id = '${taskId}'`)).toBe(1);

    await reopenCompletionIn(db, eventId, taskId, ada, talkOne);

    expect(await count("task_completions", `task_id = '${taskId}'`)).toBe(0);
    const matrix = await getTaskCompletionMatrixIn(db, eventId, taskId);
    const reopened = matrix.find((r) => r.submissionId === talkOne);
    expect(reopened?.completed).toBe(false);
    // The assignment membership itself is untouched — reopening never inserts
    // or deletes an assignment row, only the completion behind it.
    expect(matrix).toHaveLength(assignmentCount);
  });

  it("reopen is a no-op, not an error, when there is nothing to reopen", async () => {
    const { id: taskId } = await saveTaskIn(db, eventId, taskInput({ name: "Reopen no-op task" }));
    await expect(reopenCompletionIn(db, eventId, taskId, ada, talkOne)).resolves.toBeUndefined();
  });

  it("mode-lock: rejects a shape change once the task has a completion, but allows editing copy", async () => {
    const created = await saveTaskIn(db, eventId, taskInput({ name: "Mode lock task" }));
    const taskId = created.id;
    await pglite.query(
      "INSERT INTO task_completions(event_id,task_id,contact_id,submission_id,completed_via) VALUES($1,$2,$3,$4,'manual')",
      [eventId, taskId, ada, talkOne],
    );

    const changed = await saveTaskIn(db, eventId, taskInput({ id: taskId, name: "Mode lock task", targetType: "contact" }), { expectedUpdatedAt: created.updatedAt })
      .catch((thrown: unknown) => thrown);
    expect(isAppError(changed) && changed.code).toBe("FORM_LOCKED");
    expect(isAppError(changed) && changed.message).toContain("Create a new task");

    const untouched = await saveTaskIn(db, eventId, taskInput({
      id: taskId, name: "Mode lock task, renamed", descriptionHtml: "<p>Updated</p>", isActive: false,
    }), { expectedUpdatedAt: created.updatedAt });
    expect(untouched.name).toBe("Mode lock task, renamed");
    expect(untouched.isActive).toBe(false);
    expect(untouched.targetType).toBe("submission");
  });

  it("mode-lock does not block a shape-preserving save with no completions yet", async () => {
    const created = await saveTaskIn(db, eventId, taskInput({ name: "No completions yet" }));
    const saved = await saveTaskIn(db, eventId, taskInput({ id: created.id, name: "No completions yet", targetType: "contact" }), { expectedUpdatedAt: created.updatedAt });
    expect(saved.targetType).toBe("contact");
    expect(new Date(saved.updatedAt).getTime()).toBeGreaterThan(new Date(created.updatedAt).getTime());
  });

  it("the CHECK-mirroring schema rejects a mode/attachment mismatch before the DB ever sees it", () => {
    const badForm = saveTaskInputSchema.safeParse({ name: "X", targetType: "contact", completionMode: "form", isActive: true });
    expect(badForm.success).toBe(false);
    const badFileRequest = saveTaskInputSchema.safeParse({ name: "X", targetType: "contact", completionMode: "manual", fileRequestId: crypto.randomUUID(), isActive: true });
    expect(badFileRequest.success).toBe(false);
  });

  it("requires a concurrency token for updates without changing the POST contract", () => {
    const body = { name: "X", targetType: "contact", completionMode: "manual", isActive: true };
    expect(saveTaskInputSchema.safeParse(body).success).toBe(true);
    expect(updateTaskInputSchema.safeParse(body).success).toBe(false);
    expect(updateTaskInputSchema.safeParse({ ...body, expectedUpdatedAt: "2026-08-13T12:00:00.000Z" }).success).toBe(true);
  });

  it("rejects a stale full-form edit without reactivating another organizer's deactivated task", async () => {
    const created = await saveTaskIn(db, eventId, taskInput({
      name: "Two-writer task", dueAt: "2026-11-01", isActive: true,
    }));
    const oldVersion = "2020-01-02T03:04:05.000Z";
    await pglite.query("UPDATE portal_tasks SET updated_at=$2 WHERE id=$1", [created.id, oldVersion]);

    const deactivated = await saveTaskIn(db, eventId, taskInput({
      id: created.id, name: "Two-writer task", dueAt: "2026-11-01", isActive: false,
    }), { expectedUpdatedAt: oldVersion });
    expect(deactivated.isActive).toBe(false);

    const stale = await saveTaskIn(db, eventId, taskInput({
      id: created.id, name: "Two-writer task", dueAt: "2026-11-10", isActive: true,
    }), { expectedUpdatedAt: oldVersion }).catch((thrown: unknown) => thrown);
    expect(isAppError(stale) && stale.code).toBe("STALE_WRITE");

    const [current] = await listTasksIn(db, eventId, { search: "Two-writer task" });
    expect(current).toMatchObject({ isActive: false, dueAt: endOfDayInTz("2026-11-01", "America/Los_Angeles").toISOString() });
  });

  it("keeps missing and cross-event update ids as NOT_FOUND", async () => {
    const otherTask = await saveTaskIn(db, otherEventId, taskInput({ name: "Other event task" }));
    const missingId = taskIdSchema.parse("d5000000-0000-4000-8000-000000000099");
    for (const id of [otherTask.id, missingId]) {
      const missing = await saveTaskIn(db, eventId, taskInput({ id, name: "Invisible task" }), {
        expectedUpdatedAt: otherTask.updatedAt,
      }).catch((thrown: unknown) => thrown);
      expect(isAppError(missing) && missing.code).toBe("NOT_FOUND");
    }
  });

  it("converts a date-only due date through endOfDayInTz, never a naive Date parse", async () => {
    const saved = await saveTaskIn(db, eventId, taskInput({ name: "Deadline task", dueAt: "2026-11-01" }));
    expect(saved.dueAt).toBe(endOfDayInTz("2026-11-01", "America/Los_Angeles").toISOString());
  });

  it("RESTRICT: a file request in use by a task refuses to delete with a friendly message, not a raw constraint error", async () => {
    const { id: fileRequestId } = await saveFileRequestIn(db, eventId, saveFileRequestInputSchema.parse({ title: "Slides", targetType: "submission" }));
    const created = await saveTaskIn(db, eventId, taskInput({ name: "File request task", completionMode: "file_request", fileRequestId }));
    const taskId = created.id;

    const blocked = await deleteFileRequestIn(db, eventId, fileRequestId).catch((thrown: unknown) => thrown);
    expect(isAppError(blocked) && blocked.code).toBe("CONFLICT");
    expect(isAppError(blocked) && blocked.message).toBe("This form/file request is used by a task. Revert the task to Manual first.");

    // Revert to manual, then the delete succeeds — the RESTRICT constraint is
    // the backstop, this precheck is the friendly copy in front of it.
    await saveTaskIn(db, eventId, taskInput({ id: taskId, name: "File request task", completionMode: "manual" }), { expectedUpdatedAt: created.updatedAt });
    await expect(deleteFileRequestIn(db, eventId, fileRequestId)).resolves.toBeUndefined();
  });

  it("tab counts are a count of tasks, not assignments, and Group is always present at zero", async () => {
    const before = await getTaskTabCountsIn(db, eventId);
    await saveTaskIn(db, eventId, taskInput({ name: "Tab count contact task", targetType: "contact" }));
    const after = await getTaskTabCountsIn(db, eventId);
    expect(after.contact).toBe(before.contact + 1);
    expect(after.all).toBe(before.all + 1);
    expect(after.group).toBe(0);
  });

  it("listTasks filters by target type and search", async () => {
    await saveTaskIn(db, eventId, taskInput({ name: "Findable by search only", targetType: "contact" }));
    const bySearch = await listTasksIn(db, eventId, { search: "Findable by search" });
    expect(bySearch).toHaveLength(1);
    const byTarget = await listTasksIn(db, eventId, { targetType: "contact" });
    expect(byTarget.every((task) => task.targetType === "contact")).toBe(true);
  });
});
