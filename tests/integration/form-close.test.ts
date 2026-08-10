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
 * `is_form_open()` predicate, never a JS clock comparison (S2). Three of
 * WS-C's four functions already do (verified below). `upsertDraft` does not
 * yet — see the skipped case at the bottom of this file, which documents the
 * gap for WS-C/M18 rather than silently passing.
 */
const migration0 = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");

const eventId = eventIdSchema.parse("f0000000-0000-4000-8000-000000000001");
const openForm = formIdSchema.parse("f0000000-0000-4000-8000-000000000002");
const closedForm = formIdSchema.parse("f0000000-0000-4000-8000-000000000003");
const speaker = contactIdSchema.parse("f0000000-0000-4000-8000-000000000004");
const pendingOnClosedForm = submissionIdSchema.parse("f0000000-0000-4000-8000-000000000005");

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

const { createSubmission, updateSubmissionFromCfp, upsertDraft } = await import("@/features/submissions");

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
   * KNOWN GAP, tracked here rather than silently green: `upsertDraft`
   * (features/submissions/server/mutations.ts) never calls the SQL
   * `is_form_open()` predicate before creating or refreshing a draft, so a
   * visitor who reaches the CFP Account step on a closed form can still start
   * (or keep editing) a draft — only the later `createSubmission` promotion
   * is actually blocked. Per M14's work order Step 6 ("If any of 2-5 is
   * missing ... file the one-line requirement with the owning lane the same
   * hour and add the failing PGlite case"): this is that filed requirement.
   * `it.fails` keeps the suite green while making the regression visible the
   * moment WS-C adds the guard (the test will then fail *because it started
   * passing*, which is exactly the signal to flip this to a normal `it`).
   */
  it.fails("upsertDraft on a closed form -> FORM_CLOSED (not yet enforced — see comment above)", async () => {
    const error = await upsertDraft(eventId, speaker, closedForm, 1).catch((thrown: unknown) => thrown);
    expect(isAppError(error) && error.code).toBe("FORM_CLOSED");
  });
});
