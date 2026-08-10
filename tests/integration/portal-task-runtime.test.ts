import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import { contactIdSchema, eventIdSchema, formSnapshotSchema, submissionIdSchema } from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";

const migration0 = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");

const eventId = eventIdSchema.parse("c4000000-0000-4000-8000-000000000001");
const ada = contactIdSchema.parse("c4000000-0000-4000-8000-000000000010");
const grace = contactIdSchema.parse("c4000000-0000-4000-8000-000000000011");
const talkOne = submissionIdSchema.parse("c4000000-0000-4000-8000-000000000020");
const talkTwo = submissionIdSchema.parse("c4000000-0000-4000-8000-000000000021");
const pendingTalk = submissionIdSchema.parse("c4000000-0000-4000-8000-000000000022");
const headshotTask = "c4000000-0000-4000-8000-000000000030";
const slidesTask = "c4000000-0000-4000-8000-000000000031";
const profileTask = "c4000000-0000-4000-8000-000000000032";
const slidesRequest = "c4000000-0000-4000-8000-000000000040";
const deck = "c4000000-0000-4000-8000-000000000041";
const othersDeck = "c4000000-0000-4000-8000-000000000042";
const formId = "c4000000-0000-4000-8000-000000000050";
const bioField = "c4000000-0000-4000-8000-000000000051";
const shirtField = "c4000000-0000-4000-8000-000000000052";
const talkTitleField = "c4000000-0000-4000-8000-000000000053";

/**
 * A portal task form, not a CFP one: a couple of questions that write back to
 * columns an organizer already has. Built here rather than reusing the golden
 * CFP snapshot, whose five required questions say nothing about this module.
 */
const PORTAL_SNAPSHOT = formSnapshotSchema.parse({
  formId,
  version: 1,
  context: "portal",
  sections: [{
    id: "c4000000-0000-4000-8000-000000000060",
    key: "details",
    title: "Your details",
    pageHeading: "Details",
    descriptionHtml: "",
    fields: [
      {
        id: bioField, key: "bio", label: "Bio", type: "richtext", required: false, locked: false,
        maxChars: 5000, helpText: "", options: [], visibility: null, mapsTo: "contact.bio_html",
      },
      {
        id: shirtField, key: "shirt", label: "Shirt size", type: "dropdown", required: true, locked: false,
        maxChars: null, helpText: "", visibility: null, mapsTo: null,
        options: [
          { id: "m", label: "M" },
          { id: "l", label: "L" },
        ],
      },
      {
        id: talkTitleField, key: "talk_title", label: "Talk title", type: "text", required: false, locked: false,
        maxChars: 255, helpText: "", options: [], visibility: null, mapsTo: "submission.title",
      },
    ],
  }],
});

/** Every required answer, so a case can vary one thing without failing validation. */
const validAnswers = (overrides: Record<string, unknown> = {}) => ({ [shirtField]: { t: "opt", v: "m" }, ...overrides });

let pglite: PGlite;
function createTestDb(client: PGlite) {
  return drizzle(client, { schema });
}
let testDb: ReturnType<typeof createTestDb>;

// withTx opens a WebSocket Pool against Neon; the seam under test is everything
// inside it, so the suite runs the same body inside a real PGlite transaction.
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return {
    ...actual,
    withTx: async (work: (handle: TxDb) => Promise<unknown>) => testDb.transaction(
      async (handle) => work(handle as unknown as TxDb),
    ),
    db: new Proxy({}, { get: (_target, property) => Reflect.get(testDb, property, testDb) }),
  };
});

const {
  completeTaskManual, completeTaskViaResponse, completeTaskViaUpload,
  getMyTask, getTaskForm, listMyTasks, listTaskCompletions,
} = await import("@/features/portal");

async function count(table: string, where = "TRUE"): Promise<number> {
  const result = await pglite.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`);
  return result.rows[0]?.n ?? 0;
}

describe("portal task runtime", () => {
  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migration0);
    await pglite.exec(migration1);
    testDb = createTestDb(pglite);

    await pglite.query(
      "INSERT INTO events(id,name,slug,starts_at,ends_at) VALUES($1,'Task Event','task-event','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
      [eventId],
    );
    await pglite.query("INSERT INTO contacts(id,event_id,email,first_name,last_name,company) VALUES($1,$2,'ada@example.com','Ada','Lovelace','Analytical Engines')", [ada, eventId]);
    await pglite.query("INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES($1,$2,'grace@example.com','Grace','Hopper')", [grace, eventId]);

    // Ada speaks twice and co-speaks nothing; Grace is the primary on neither
    // accepted talk, so the fan-out has someone to leave out.
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
    await pglite.query(
      "INSERT INTO submission_participants(event_id,submission_id,contact_id,is_primary,sort_order) VALUES($1,$2,$3,false,1)",
      [eventId, talkOne, grace],
    );

    await pglite.query(
      "INSERT INTO file_requests(id,event_id,title,target_type,instructions_html,max_size_mb) VALUES($1,$2,'Slides','submission','<p>PDF please</p>',25)",
      [slidesRequest, eventId],
    );
    await pglite.query(
      "INSERT INTO forms(id,event_id,context,internal_name,status,target_type,current_version) VALUES($1,$2,'portal','Update your details','open','contact',1)",
      [formId, eventId],
    );
    await pglite.query("INSERT INTO form_versions(event_id,form_id,version,snapshot) VALUES($1,$2,1,$3::jsonb)", [eventId, formId, JSON.stringify(PORTAL_SNAPSHOT)]);

    await pglite.query(
      "INSERT INTO portal_tasks(id,event_id,name,description_html,target_type,completion_mode,due_at,sort_order) VALUES($1,$2,'Confirm your headshot','<p>Send one</p>','contact','manual', now() - interval '1 day',0)",
      [headshotTask, eventId],
    );
    await pglite.query(
      "INSERT INTO portal_tasks(id,event_id,name,target_type,completion_mode,file_request_id,sort_order) VALUES($1,$2,'Upload your slides','submission','file_request',$3,1)",
      [slidesTask, eventId, slidesRequest],
    );
    await pglite.query(
      "INSERT INTO portal_tasks(id,event_id,name,target_type,completion_mode,form_id,sort_order) VALUES($1,$2,'Update your details','contact','form',$3,2)",
      [profileTask, eventId, formId],
    );

    await pglite.query(
      "INSERT INTO file_assets(id,event_id,kind,r2_key,filename,mime,size_bytes,uploaded_by_contact_id) VALUES($1,$2,'upload','uploads/deck.pdf','deck.pdf','application/pdf',1024,$3)",
      [deck, eventId, ada],
    );
    // Somebody else's private deck, for the case that must not be able to reach it.
    await pglite.query(
      "INSERT INTO file_assets(id,event_id,kind,r2_key,filename,mime,size_bytes,uploaded_by_contact_id) VALUES($1,$2,'upload','uploads/secret.pdf','secret.pdf','application/pdf',2048,$3)",
      [othersDeck, eventId, grace],
    );
  }, 60_000);

  beforeEach(async () => {
    await pglite.exec("TRUNCATE task_completions, file_uploads, form_responses CASCADE");
  });

  it("fan-out: routes a submission task once per accepted submission, never for a pending one", async () => {
    const tasks = await listMyTasks(eventId, ada);
    const slides = tasks.filter((task) => task.taskId === slidesTask);
    expect(slides.map((task) => task.submissionCode).sort()).toEqual([1, 2]);
    expect(slides.some((task) => task.submissionId === pendingTalk)).toBe(false);
    // Contact-targeted tasks land once, with no submission attached.
    expect(tasks.filter((task) => task.taskId === headshotTask)).toHaveLength(1);
    expect(tasks.find((task) => task.taskId === headshotTask)?.submissionId).toBeNull();
  });

  it("reads overdue from the view rather than the caller's clock", async () => {
    const [overdue] = (await listMyTasks(eventId, ada)).filter((task) => task.taskId === headshotTask);
    expect(overdue?.overdue).toBe(true);
    expect(overdue?.dueAt).toMatch(/^\d{4}-/);
    // A task with no due date is a designed state, not an overdue one.
    expect((await listMyTasks(eventId, ada)).find((task) => task.taskId === profileTask)?.overdue).toBe(false);
  });

  it("gives a co-speaker who is not the primary contact no submission tasks", async () => {
    // The fan-out law: submission tasks assign to the primary contact only.
    const tasks = await listMyTasks(eventId, grace);
    expect(tasks.filter((task) => task.submissionId !== null)).toEqual([]);
  });

  it("fan-out-independent-completion: completes the two copies of one task independently", async () => {
    await completeTaskManual(eventId, ada, headshotTask, null);
    await completeTaskViaUpload(eventId, ada, slidesTask, talkOne, deck);

    const tasks = await listMyTasks(eventId, ada);
    const slides = tasks.filter((task) => task.taskId === slidesTask);
    expect(slides.find((task) => task.submissionId === talkOne)?.completed).toBe(true);
    expect(slides.find((task) => task.submissionId === talkTwo)?.completed).toBe(false);
  });

  it("idempotent-complete: treats a double-click as one completion", async () => {
    await completeTaskManual(eventId, ada, headshotTask, null);
    await completeTaskManual(eventId, ada, headshotTask, null);
    expect(await count("task_completions")).toBe(1);
  });

  it("refuses a task that is not routed to this speaker", async () => {
    const notMine = await completeTaskManual(eventId, grace, slidesTask, talkOne).catch((thrown: unknown) => thrown);
    expect(isAppError(notMine) && notMine.code).toBe("NOT_FOUND");
    // Nor by inventing a submission id the task was never assigned against.
    const notThere = await completeTaskManual(eventId, ada, headshotTask, pendingTalk).catch((thrown: unknown) => thrown);
    expect(isAppError(notThere) && notThere.code).toBe("NOT_FOUND");
    expect(await count("task_completions")).toBe(0);
  });

  it("refuses to finish a file task with a click, or a manual task with a file", async () => {
    const clicked = await completeTaskManual(eventId, ada, slidesTask, talkOne).catch((thrown: unknown) => thrown);
    expect(isAppError(clicked) && clicked.code).toBe("VALIDATION");
    expect(isAppError(clicked) && clicked.message).toContain("file request");
    const uploaded = await completeTaskViaUpload(eventId, ada, headshotTask, null, deck).catch((thrown: unknown) => thrown);
    expect(isAppError(uploaded) && uploaded.code).toBe("VALIDATION");
    expect(await count("task_completions")).toBe(0);
  });

  it("keeps every upload and completes only once", async () => {
    await completeTaskViaUpload(eventId, ada, slidesTask, talkOne, deck);
    await completeTaskViaUpload(eventId, ada, slidesTask, talkOne, deck);
    expect(await count("file_uploads")).toBe(2);
    expect(await count("task_completions")).toBe(1);

    const detail = await getMyTask(eventId, ada, slidesTask, talkOne);
    expect(detail?.uploads).toHaveLength(2);
    expect(detail?.fileRequest?.maxSizeMb).toBe(25);
    expect(detail?.completed).toBe(true);
  });

  it("refuses to answer a task with another speaker's file", async () => {
    // file_uploads grants download rights, so accepting somebody else's asset
    // here would hand this speaker a presigned URL to it.
    const stolen = await completeTaskViaUpload(eventId, ada, slidesTask, talkOne, othersDeck)
      .catch((thrown: unknown) => thrown);
    expect(isAppError(stolen) && stolen.code).toBe("NOT_FOUND");
    expect(await count("file_uploads")).toBe(0);
    expect(await count("task_completions")).toBe(0);
  });

  it("points a re-upload's completion at the newest file", async () => {
    await completeTaskViaUpload(eventId, ada, slidesTask, talkOne, deck);
    const first = await pglite.query<{ file_upload_id: string }>("SELECT file_upload_id FROM task_completions");
    await completeTaskViaUpload(eventId, ada, slidesTask, talkOne, deck);
    const second = await pglite.query<{ file_upload_id: string }>("SELECT file_upload_id FROM task_completions");
    // Otherwise the organizer keeps being served the version the speaker replaced.
    expect(second.rows[0]?.file_upload_id).not.toBe(first.rows[0]?.file_upload_id);
    expect(await count("task_completions")).toBe(1);
  });

  it("never records a completion with no file behind it", async () => {
    const missing = await completeTaskViaUpload(eventId, ada, slidesTask, talkOne, "c4000000-0000-4000-8000-0000000000ff")
      .catch((thrown: unknown) => thrown);
    expect(isAppError(missing) && missing.code).toBe("NOT_FOUND");
    expect(await count("task_completions")).toBe(0);
    expect(await count("file_uploads")).toBe(0);
  });

  it("write-back-field-scoped: writes a form response back to only the fields it asked about", async () => {
    await completeTaskViaResponse(eventId, ada, profileTask, null, validAnswers({
      [bioField]: { t: "s", v: "<p>Ada builds engines.</p>" },
    }));

    const contact = await pglite.query<{ bio_html: string | null; company: string; first_name: string }>(
      "SELECT bio_html, company, first_name FROM contacts WHERE id = $1", [ada],
    );
    expect(contact.rows[0]?.bio_html).toContain("Ada builds engines");
    // The form asked about a bio, so the company somebody edited on the Profile
    // page a minute ago is still there.
    expect(contact.rows[0]?.company).toBe("Analytical Engines");
    expect(contact.rows[0]?.first_name).toBe("Ada");
    expect(await count("form_responses")).toBe(1);
    expect(await count("task_completions", "completed_via = 'form_response'")).toBe(1);
  });

  it("overwrites the response on a resubmit instead of versioning it", async () => {
    await completeTaskViaResponse(eventId, ada, profileTask, null, validAnswers({ [bioField]: { t: "s", v: "<p>First answer</p>" } }));
    await completeTaskViaResponse(eventId, ada, profileTask, null, validAnswers({ [bioField]: { t: "s", v: "<p>Second answer</p>" } }));
    expect(await count("form_responses")).toBe(1);
    expect(await count("task_completions")).toBe(1);
    const stored = await pglite.query<{ answers: Array<{ value: { v: string } }> }>("SELECT answers FROM form_responses");
    expect(JSON.stringify(stored.rows[0]?.answers)).toContain("Second answer");
  });

  it("rejects an answer the form would reject, and writes nothing", async () => {
    const invalid = await completeTaskViaResponse(eventId, ada, profileTask, null, { [bioField]: { t: "s", v: "<p>No shirt size</p>" } })
      .catch((thrown: unknown) => thrown);
    expect(isAppError(invalid) && invalid.code).toBe("VALIDATION");
    expect(await count("form_responses")).toBe(0);
    expect(await count("task_completions")).toBe(0);
  });

  it("drops a field the organizer has since removed rather than failing the submit", async () => {
    await completeTaskViaResponse(eventId, ada, profileTask, null, validAnswers({
      "c4000000-0000-4000-8000-0000000000aa": { t: "s", v: "a question that no longer exists" },
    }));
    expect(await count("task_completions")).toBe(1);
    const stored = await pglite.query<{ answers: string }>("SELECT answers::text AS answers FROM form_responses");
    expect(stored.rows[0]?.answers).not.toContain("no longer exists");
  });

  it("prefills a form from the columns its questions map to", async () => {
    await pglite.query("UPDATE contacts SET bio_html = '<p>On file already.</p>' WHERE id = $1", [ada]);
    const form = await getTaskForm(eventId, ada, formId, null);
    expect(form.snapshot.version).toBe(1);
    expect(form.answers[bioField]).toEqual({ t: "s", v: "<p>On file already.</p>" });
    // Nothing to prefill an unmapped question with, so it starts empty.
    expect(form.answers[shirtField]).toBeUndefined();
    await pglite.query("UPDATE contacts SET bio_html = NULL WHERE id = $1", [ada]);
  });

  it("shows a saved answer over the column it was derived from", async () => {
    await pglite.query("UPDATE contacts SET bio_html = '<p>Stale.</p>' WHERE id = $1", [ada]);
    await completeTaskViaResponse(eventId, ada, profileTask, null, validAnswers({ [bioField]: { t: "s", v: "<p>Fresher.</p>" } }));
    const form = await getTaskForm(eventId, ada, formId, null);
    expect(form.answers[bioField]).toEqual({ t: "s", v: "<p>Fresher.</p>" });
    // The shirt size is not on any column, so only the saved response has it.
    expect(form.answers[shirtField]).toEqual({ t: "opt", v: "m" });
    await pglite.query("UPDATE contacts SET bio_html = NULL WHERE id = $1", [ada]);
  });

  it("shows an organizer who completed a task and what they sent", async () => {
    await completeTaskViaResponse(eventId, ada, profileTask, null, validAnswers({ [bioField]: { t: "s", v: "<p>Ada again.</p>" } }));
    await completeTaskViaUpload(eventId, ada, slidesTask, talkOne, deck);

    // Stored as a jsonb object keyed by field id — the shape R2's orphan sweep
    // walks for live `{t:'file'}` references.
    const shape = await pglite.query<{ kind: string }>("SELECT jsonb_typeof(answers) AS kind FROM form_responses");
    expect(shape.rows[0]?.kind).toBe("object");

    const responses = await listTaskCompletions(eventId, profileTask);
    expect(responses).toHaveLength(1);
    expect(responses[0]?.contactName).toBe("Ada Lovelace");
    // Labels come from the version the answer was written against.
    expect(responses[0]?.answers.map((answer) => answer.label).sort()).toEqual(["Bio", "Shirt size"]);

    const uploads = await listTaskCompletions(eventId, slidesTask);
    expect(uploads[0]?.file?.filename).toBe("deck.pdf");
    expect(uploads[0]?.submissionCode).toBe(1);
  });
});
