import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import { cleanAnswersSchema, contactIdSchema, eventIdSchema, formIdSchema, submissionIdSchema, type CreateSubmissionInput } from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";

/**
 * M14 Step 6 — "the guard everywhere it must bite": all four call sites that
 * can create or change a submission against a form must share the SQL
 * `is_form_open()` predicate, never a JS clock comparison (S2). All four of
 * WS-C's functions now do, `upsertDraft` included (see the case below that
 * used to be `it.fails` and is now a normal, passing case).
 */
const migration0 = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");
// M50 is additive on top of the base schema; applying it keeps this fixture
// aligned with the columns the repository modules now read.
const migrationReviewOps = readFileSync(new URL("../../drizzle/0004_review_operations.sql", import.meta.url), "utf8");
// M51 added `contacts.workflow_status`; contact creation (`getOrCreateContact`,
// used by `createSubmission`/`upsertDraft` for the submitter) has an
// unqualified `.returning()` that now selects it.
const migrationRoster = readFileSync(new URL("../../drizzle/0008_speaker_roster_operations.sql", import.meta.url), "utf8");
const migrationSubmissionGuards = readFileSync(new URL("../../drizzle/0036_submission_limit_guards.sql", import.meta.url), "utf8");

const eventId = eventIdSchema.parse("f0000000-0000-4000-8000-000000000001");
const openForm = formIdSchema.parse("f0000000-0000-4000-8000-000000000002");
const closedForm = formIdSchema.parse("f0000000-0000-4000-8000-000000000003");
const speaker = contactIdSchema.parse("f0000000-0000-4000-8000-000000000004");
const pendingOnClosedForm = submissionIdSchema.parse("f0000000-0000-4000-8000-000000000005");
// A still-open draft (status='draft', never promoted) sitting on the closed
// form, for the "autosave keeps writing after close" case — M14-GAP.
const draftOnClosedForm = submissionIdSchema.parse("f0000000-0000-4000-8000-000000000007");
// Boundary-instant form: closes_at is stamped from SQL `now()` at insert time
// rather than a JS-computed timestamp, so it sits right on is_form_open's
// edge (`closes_at > now()`, i.e. equality already reads closed) instead of
// comfortably in the past like `closedForm` above.
const boundaryForm = formIdSchema.parse("f0000000-0000-4000-8000-000000000006");

let pglite: PGlite;
function createTestDb(client: PGlite) {
  return drizzle(client, { schema });
}
let testDb: ReturnType<typeof createTestDb>;

// Same seam as submissions-create.test.ts / submissions-edit.test.ts: run the
// audited withTx body against a real PGlite transaction rather than a Neon
// WebSocket Pool.
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return {
    ...actual,
    withTx: async (work: (handle: TxDb) => Promise<unknown>) => testDb.transaction(
      async (handle) => work(handle as unknown as TxDb),
    ),
  };
});

const { createSubmission, updateSubmissionFromCfp, upsertDraft, saveDraftAnswers } = await import("@/features/submissions");

function cfpInput(overrides: Partial<CreateSubmissionInput> = {}): CreateSubmissionInput {
  return {
    formId: closedForm,
    formVersion: 1,
    source: "cfp",
    kind: "abstract",
    submitterContactId: speaker,
    fields: { title: "A talk about caching" },
    participants: [{ contactId: speaker, role: "speaker", isPrimary: true, sortOrder: 0 }],
    answers: cleanAnswersSchema.parse([]),
    ...overrides,
  };
}

beforeAll(async () => {
  pglite = new PGlite();
  await pglite.exec(migration0);
  await pglite.exec(migration1);
  await pglite.exec(migrationReviewOps);
  await pglite.exec(migrationRoster);
  await pglite.exec(migrationSubmissionGuards);
  testDb = createTestDb(pglite);

  await pglite.query(
    "INSERT INTO events(id,name,slug,starts_at,ends_at) VALUES($1,'Event','form-close-event','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
    [eventId],
  );
  await pglite.query(
    "INSERT INTO forms(id,event_id,context,internal_name,status,closes_at) VALUES($1,$2,'cfp','Open CFP','open', now() + interval '10 days')",
    [openForm, eventId],
  );
  // Seeded closed exactly as the AC prescribes: closes_at in the past.
  await pglite.query(
    "INSERT INTO forms(id,event_id,context,internal_name,status,closes_at) VALUES($1,$2,'cfp','Closed CFP','open', now() - interval '1 day')",
    [closedForm, eventId],
  );
  // Boundary instant: closes_at = now() at the moment of this INSERT. Every
  // later statement in this suite runs after that instant, so by the time
  // upsertDraft's own `SELECT is_form_open(...)` executes, `closes_at` is
  // equal to or (by however many microseconds elapsed) just past `now()` —
  // exactly the edge `is_form_open` treats as closed (`closes_at > now()`,
  // so equality already fails open), never comfortably in the past like
  // `closedForm` above.
  await pglite.query(
    "INSERT INTO forms(id,event_id,context,internal_name,status,closes_at) VALUES($1,$2,'cfp','Boundary CFP','open', now())",
    [boundaryForm, eventId],
  );
  await pglite.query(
    "INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES($1,$2,'speaker@example.com','Test','Speaker')",
    [speaker, eventId],
  );
  // A submission already sitting on the closed form, for the "editing after
  // close" case — `updateSubmissionFromCfp` must refuse this even though the
  // submission predates the deadline.
  await pglite.query(
    `INSERT INTO submissions(id,event_id,form_id,form_version,code,kind,status,source,submitter_contact_id,title)
     VALUES($1,$2,$3,1,9001,'abstract','pending','cfp',$4,'Already submitted')`,
    [pendingOnClosedForm, eventId, closedForm, speaker],
  );
  // A draft that was started before the deadline and never promoted — the
  // autosave path (`saveDraftAnswers`) must refuse to keep writing to it
  // once the form has closed, same as every other write path.
  await pglite.query(
    `INSERT INTO submissions(id,event_id,form_id,form_version,code,kind,status,source,submitter_contact_id,title)
     VALUES($1,$2,$3,1,9002,'abstract','draft','cfp',$4,'')`,
    [draftOnClosedForm, eventId, closedForm, speaker],
  );
}, 60_000);

afterAll(async () => {
  await pglite.close();
});

describe("form-close guard: the four write paths that must agree with is_form_open()", () => {
  it("createSubmission on a closed form -> FORM_CLOSED", async () => {
    const error = await createSubmission(eventId, cfpInput()).catch((thrown: unknown) => thrown);
    expect(isAppError(error) && error.code).toBe("FORM_CLOSED");
  });

  it("updateSubmissionFromCfp on a closed form -> FORM_CLOSED (closes new AND updated submissions)", async () => {
    const error = await updateSubmissionFromCfp(eventId, speaker, pendingOnClosedForm, cleanAnswersSchema.parse([]))
      .catch((thrown: unknown) => thrown);
    expect(isAppError(error) && error.code).toBe("FORM_CLOSED");
  });

  it("createSubmission on an open form succeeds (control case: the guard only fires when it should)", async () => {
    const result = await createSubmission(eventId, cfpInput({ formId: openForm, formVersion: 1 }));
    expect(result.status).toBe("pending");
  });

  /**
   * M14-GAP: `upsertDraft` (features/submissions/server/mutations.ts) now
   * calls the same `assertFormOpen` helper — the SQL `is_form_open()`
   * predicate — that `createSubmissionIn`/`updateSubmissionFromCfp` already
   * used, before creating or refreshing a draft. A visitor who reaches the
   * CFP Account step on a closed form can no longer start (or keep editing)
   * a draft. This used to be a documented `it.fails` gap (M14's work order
   * Step 6); it is now a normal, passing case.
   */
  it("upsertDraft on a closed form -> FORM_CLOSED", async () => {
    const error = await upsertDraft(eventId, speaker, closedForm, 1).catch((thrown: unknown) => thrown);
    expect(isAppError(error) && error.code).toBe("FORM_CLOSED");
  });

  it("upsertDraft on a form closing at exactly this instant -> FORM_CLOSED (the boundary is closed, not open)", async () => {
    const error = await upsertDraft(eventId, speaker, boundaryForm, 1).catch((thrown: unknown) => thrown);
    expect(isAppError(error) && error.code).toBe("FORM_CLOSED");
  });

  it("upsertDraft on an open form succeeds (control case: the guard only fires when it should)", async () => {
    const result = await upsertDraft(eventId, speaker, openForm, 1);
    expect(result.code).toBeGreaterThan(0);
  });

  /**
   * M14-GAP: `saveDraftAnswers` (the PATCH /api/internal/forms/[formId]/draft
   * autosave path) now shares the same `assertFormOpen` guard as the other
   * three write paths. Before this fix a speaker who already had a draft
   * could keep writing new answers to it indefinitely after `closes_at` had
   * passed — this is the case that makes that true.
   */
  it("saveDraftAnswers on a closed form -> FORM_CLOSED (autosave stops once the form closes, not just upsertDraft)", async () => {
    const error = await saveDraftAnswers(eventId, speaker, closedForm, 1, cleanAnswersSchema.parse([]))
      .catch((thrown: unknown) => thrown);
    expect(isAppError(error) && error.code).toBe("FORM_CLOSED");
  });
});
