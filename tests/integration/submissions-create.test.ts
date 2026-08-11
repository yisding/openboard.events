import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import { cleanAnswersSchema, contactIdSchema, eventIdSchema, formIdSchema, type CreateSubmissionInput } from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";

const migration0 = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");
// M50 is additive on top of the base schema; applying it keeps this fixture
// aligned with the columns the repository modules now read.
const migrationReviewOps = readFileSync(new URL("../../drizzle/0004_review_operations.sql", import.meta.url), "utf8");
// M51 added `contacts.workflow_status`; `getOrCreateContact`'s unqualified
// `.returning()` (used for the submitter contact) now selects it.
const migrationRoster = readFileSync(new URL("../../drizzle/0008_speaker_roster_operations.sql", import.meta.url), "utf8");

const eventId = eventIdSchema.parse("e0000000-0000-4000-8000-000000000001");
const openForm = formIdSchema.parse("e0000000-0000-4000-8000-000000000002");
const closedForm = formIdSchema.parse("e0000000-0000-4000-8000-000000000003");
const speaker = contactIdSchema.parse("e0000000-0000-4000-8000-000000000004");
const missingContact = contactIdSchema.parse("e0000000-0000-4000-8000-000000000005");
const titleField = "e0000000-0000-4000-8000-000000000006";
const bioField = "e0000000-0000-4000-8000-000000000007";
const section = "e0000000-0000-4000-8000-000000000008";

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
  };
});

const { createSubmission, nextSubmissionCode, upsertDraft } = await import("@/features/submissions");

const noAnswers = cleanAnswersSchema.parse([]);

function cfpInput(overrides: Partial<CreateSubmissionInput> = {}): CreateSubmissionInput {
  return {
    formId: openForm,
    formVersion: 1,
    source: "cfp",
    kind: "abstract",
    submitterContactId: speaker,
    fields: { title: "A talk about caching", descriptionHtml: "<p>Fast pages</p><script>alert(1)</script>" },
    participants: [{ contactId: speaker, role: "speaker", isPrimary: true, sortOrder: 0 }],
    answers: noAnswers,
    ...overrides,
  };
}

async function countRows(table: string, where = "TRUE"): Promise<number> {
  const result = await pglite.query<{ count: number }>(`SELECT count(*)::int AS count FROM ${table} WHERE ${where}`);
  return result.rows[0]?.count ?? 0;
}

describe("createSubmission", () => {
  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migration0);
    await pglite.exec(migration1);
    await pglite.exec(migrationReviewOps);
    await pglite.exec(migrationRoster);
    testDb = createTestDb(pglite);

    await pglite.query(
      "INSERT INTO events(id,name,slug,starts_at,ends_at,submission_cap_per_user) VALUES($1,'Event','event','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z',2)",
      [eventId],
    );
    await pglite.query(
      "INSERT INTO forms(id,event_id,context,internal_name,status,closes_at) VALUES($1,$2,'cfp','Open CFP','open', now() + interval '10 days')",
      [openForm, eventId],
    );
    await pglite.query(
      "INSERT INTO forms(id,event_id,context,internal_name,status,closes_at) VALUES($1,$2,'cfp','Closed CFP','open', now() - interval '1 day')",
      [closedForm, eventId],
    );
    await pglite.query(
      "INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES($1,$2,'speaker@example.com','Test','Speaker')",
      [speaker, eventId],
    );
    await pglite.query(
      "INSERT INTO form_sections(id,event_id,form_id,key) VALUES($1,$2,$3,'main')",
      [section, eventId, openForm],
    );
    for (const [id, key] of [[titleField, "title"], [bioField, "bio"]] as const) {
      await pglite.query(
        "INSERT INTO form_fields(id,event_id,form_id,section_id,key,label,field_type) VALUES($1,$2,$3,$4,$5,$5,'text')",
        [id, eventId, openForm, section, key],
      );
    }
  }, 60_000);

  afterAll(async () => {
    await pglite.close();
  });

  it("allocates sequential codes with no gaps or duplicates", async () => {
    const codes = await testDb.transaction(async (handle) => {
      const allocated: number[] = [];
      for (let index = 0; index < 10; index += 1) {
        allocated.push(await nextSubmissionCode(handle as unknown as TxDb, eventId));
      }
      return allocated;
    });
    expect(new Set(codes).size).toBe(10);
    expect(codes).toEqual([...codes].sort((a, b) => a - b));
    expect((codes.at(-1) ?? 0) - (codes[0] ?? 0)).toBe(9);
  });

  it("creates a CFP submission with exactly one confirmation email", async () => {
    await pglite.query("DELETE FROM submissions");
    await pglite.query("DELETE FROM communication_logs");
    const result = await createSubmission(eventId, cfpInput());
    expect(result.status).toBe("pending");
    expect(result.promotedFromDraft).toBe(false);

    // The description goes through the sanitizer on the way in, so a stored XSS
    // never reaches the render surfaces that trust the column.
    const rows = await pglite.query<{ description_html: string; submitted_at: Date | null }>(
      "SELECT description_html, submitted_at FROM submissions WHERE id=$1",
      [result.submissionId],
    );
    expect(rows.rows[0]?.description_html).not.toContain("<script");
    expect(rows.rows[0]?.submitted_at).not.toBeNull();

    expect(await countRows("communication_logs", `template_key='submission_received'`)).toBe(1);
    expect(await countRows("submission_participants", "is_primary")).toBe(1);
  });

  it("uses the form kind for a new form-backed submission", async () => {
    await pglite.query("DELETE FROM submissions");
    const result = await createSubmission(eventId, cfpInput({ kind: "session", sendConfirmation: false }));
    const rows = await pglite.query<{ kind: string }>("SELECT kind FROM submissions WHERE id=$1", [result.submissionId]);
    expect(rows.rows[0]?.kind).toBe("abstract");
  });

  it("refuses a closed form against the database clock", async () => {
    const error = await createSubmission(eventId, cfpInput({ formId: closedForm })).catch((thrown: unknown) => thrown);
    expect(isAppError(error) && error.code).toBe("FORM_CLOSED");
  });

  it("refuses once the per-user limit is used up, and drafts do not count", async () => {
    await pglite.query("DELETE FROM submissions");
    await pglite.query("DELETE FROM communication_logs");
    await createSubmission(eventId, cfpInput({ fields: { title: "First talk" } }));
    await createSubmission(eventId, cfpInput({ fields: { title: "Second talk" } }));
    const draft = await upsertDraft(eventId, speaker, openForm, 1);

    const error = await createSubmission(eventId, cfpInput({ fields: { title: "Third talk" } }))
      .catch((thrown: unknown) => thrown);
    expect(isAppError(error) && error.code).toBe("LIMIT_REACHED");
    expect(await countRows("submissions", "status='pending'")).toBe(2);
    expect(await countRows("submissions", "status='draft'")).toBe(1);
    const rows = await pglite.query<{ status: string }>("SELECT status FROM submissions WHERE id=$1", [draft.submissionId]);
    expect(rows.rows[0]?.status).toBe("draft");
  });

  it("promotes a draft in place, keeping the code the speaker was shown", async () => {
    await pglite.query("DELETE FROM submissions");
    const draft = await upsertDraft(eventId, speaker, openForm, 3);
    const submitted = await createSubmission(eventId, cfpInput({ formVersion: 3 }));

    expect(submitted.promotedFromDraft).toBe(true);
    expect(submitted.submissionId).toBe(draft.submissionId);
    expect(submitted.code).toBe(draft.code);
    expect(await countRows("submissions")).toBe(1);
  });

  it("keeps the form kind when a caller promotes a draft with a mismatched kind", async () => {
    await pglite.query("DELETE FROM submissions");
    const draft = await upsertDraft(eventId, speaker, openForm, 3);
    await createSubmission(eventId, cfpInput({ formVersion: 3, kind: "session", sendConfirmation: false }));
    const rows = await pglite.query<{ kind: string }>("SELECT kind FROM submissions WHERE id=$1", [draft.submissionId]);
    expect(rows.rows[0]?.kind).toBe("abstract");
  });

  it("rejects an illegal draft promotion before the database trigger", async () => {
    await pglite.query("DELETE FROM submissions");
    const draft = await upsertDraft(eventId, speaker, openForm, 1);

    const error = await createSubmission(eventId, cfpInput({ initialStatus: "accepted" }))
      .catch((thrown: unknown) => thrown);

    expect(isAppError(error) && error.code).toBe("STALE_STATUS");
    const rows = await pglite.query<{ status: string; submitted_at: Date | null }>(
      "SELECT status,submitted_at FROM submissions WHERE id=$1",
      [draft.submissionId],
    );
    expect(rows.rows[0]).toEqual({ status: "draft", submitted_at: null });
  });

  it("rolls back a partially written submission", async () => {
    await pglite.query("DELETE FROM submissions");
    const before = await pglite.query<{ submission_seq: number }>("SELECT submission_seq FROM events WHERE id=$1", [eventId]);

    const error = await createSubmission(eventId, cfpInput({
      participants: [{ contactId: missingContact, role: "speaker", isPrimary: true, sortOrder: 0 }],
    })).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(Error);
    expect(await countRows("submissions")).toBe(0);
    const after = await pglite.query<{ submission_seq: number }>("SELECT submission_seq FROM events WHERE id=$1", [eventId]);
    expect(after.rows[0]?.submission_seq).toBe(before.rows[0]?.submission_seq);
  });

  it("writes a manual row with no deadline, limit or confirmation", async () => {
    await pglite.query("DELETE FROM submissions");
    await pglite.query("DELETE FROM communication_logs");

    const result = await createSubmission(eventId, cfpInput({
      formId: closedForm,
      source: "manual",
      enforce: { deadline: false, limit: false },
      sendConfirmation: false,
      fields: { title: "Added by an organizer" },
    }));

    expect(result.code).toBeGreaterThan(0);
    expect(await countRows("communication_logs")).toBe(0);
  });

  it("honours the form's own confirmation toggle when the caller passes none", async () => {
    await pglite.query("DELETE FROM submissions");
    await pglite.query("DELETE FROM communication_logs");
    await pglite.query("UPDATE forms SET send_confirmation=false WHERE id=$1", [openForm]);

    try {
      await createSubmission(eventId, cfpInput());
      // M14's toggle only works because the per-form flag decides here.
      expect(await countRows("communication_logs")).toBe(0);
    } finally {
      await pglite.query("UPDATE forms SET send_confirmation=true WHERE id=$1", [openForm]);
    }
  });

  it("is idempotent when the same submit is retried", async () => {
    await pglite.query("DELETE FROM submissions");
    await pglite.query("DELETE FROM communication_logs");
    const draft = await upsertDraft(eventId, speaker, openForm, 1);

    const first = await createSubmission(eventId, cfpInput({ draftSubmissionId: draft.submissionId }));
    // The retry finds no draft — the first call promoted it — so without the
    // draft id it would allocate a new code and duplicate the proposal.
    const retry = await createSubmission(eventId, cfpInput({ draftSubmissionId: draft.submissionId }));

    expect(retry.submissionId).toBe(first.submissionId);
    expect(retry.code).toBe(first.code);
    expect(await countRows("submissions")).toBe(1);
    expect(await countRows("communication_logs")).toBe(1);
  });

  it("returns an already submitted draft before rechecking the now-consumed limit", async () => {
    await pglite.query("DELETE FROM submissions");
    await pglite.query("DELETE FROM communication_logs");
    await pglite.query("UPDATE events SET submission_cap_per_user=1 WHERE id=$1", [eventId]);
    const draft = await upsertDraft(eventId, speaker, openForm, 1);

    const first = await createSubmission(eventId, cfpInput({ draftSubmissionId: draft.submissionId }));
    const retry = await createSubmission(eventId, cfpInput({ draftSubmissionId: draft.submissionId }));

    expect(retry.submissionId).toBe(first.submissionId);
    expect(await countRows("submissions")).toBe(1);
    await pglite.query("UPDATE events SET submission_cap_per_user=2 WHERE id=$1", [eventId]);
  });

  it("never promotes a speaker's draft into an organizer's manual submission", async () => {
    await pglite.query("DELETE FROM submissions");
    const draft = await upsertDraft(eventId, speaker, openForm, 1);

    const manual = await createSubmission(eventId, cfpInput({
      source: "manual",
      enforce: { deadline: false, limit: false },
      sendConfirmation: false,
      fields: { title: "Organizer added this" },
    }));

    expect(manual.promotedFromDraft).toBe(false);
    expect(manual.submissionId).not.toBe(draft.submissionId);
    // The speaker's draft is still theirs, still a draft.
    const rows = await pglite.query<{ status: string }>("SELECT status FROM submissions WHERE id=$1", [draft.submissionId]);
    expect(rows.rows[0]?.status).toBe("draft");
  });

  it("refuses a draft against another event's form", async () => {
    const otherEvent = "e0000000-0000-4000-8000-000000000009";
    await pglite.query(
      "INSERT INTO events(id,name,slug,starts_at,ends_at) VALUES($1,'Other','other','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z') ON CONFLICT DO NOTHING",
      [otherEvent],
    );
    const error = await upsertDraft(eventIdSchema.parse(otherEvent), speaker, openForm, 1).catch((thrown: unknown) => thrown);
    expect(isAppError(error) && error.code).toBe("NOT_FOUND");
  });

  it("upsertDraft returns the same row and code when called twice", async () => {
    await pglite.query("DELETE FROM submissions");
    const first = await upsertDraft(eventId, speaker, openForm, 1);
    const second = await upsertDraft(eventId, speaker, openForm, 2);

    expect(second.submissionId).toBe(first.submissionId);
    expect(second.code).toBe(first.code);
    expect(await countRows("submissions", "status='draft'")).toBe(1);

    const rows = await pglite.query<{ form_version: number }>("SELECT form_version FROM submissions WHERE id=$1", [first.submissionId]);
    expect(rows.rows[0]?.form_version).toBe(2);
  });

  // Answers are written in one multi-row statement inside the event-row lock,
  // so these cover what batching changed rather than what it kept.
  describe("answer writing", () => {
    async function answersFor(submissionId: string) {
      const rows = await pglite.query<{ field_id: string; participant_id: string | null; value: unknown }>(
        "SELECT field_id, participant_id, value FROM submission_answers WHERE submission_id=$1 ORDER BY field_id",
        [submissionId],
      );
      return rows.rows;
    }

    it("writes every answer, participant-scoped ones included", async () => {
      await pglite.query("DELETE FROM submissions");
      const result = await createSubmission(eventId, cfpInput({
        answers: cleanAnswersSchema.parse([
          { fieldId: titleField, participantId: null, value: { t: "s", v: "Batched" } },
          { fieldId: bioField, participantId: null, value: { t: "s", v: "A bio" } },
          // Same field, once for the submission and once for the speaker:
          // distinct rows, and why the conflict target includes participant_id.
          { fieldId: bioField, participantId: speaker, value: { t: "s", v: "Their bio" } },
        ]),
      }));

      const rows = await answersFor(result.submissionId);
      expect(rows).toHaveLength(3);
      expect(rows.filter((row) => row.participant_id !== null)).toHaveLength(1);
    });

    it("cannot be handed the duplicate a single INSERT could not apply twice", () => {
      // The batched write has no duplicate handling because it cannot receive
      // one: UNIQUE NULLS NOT DISTINCT makes these two collide, and the branded
      // contract refuses the pair long before the database would.
      expect(cleanAnswersSchema.safeParse([
        { fieldId: titleField, participantId: null, value: { t: "s", v: "First" } },
        { fieldId: titleField, participantId: null, value: { t: "s", v: "Second" } },
      ]).success).toBe(false);
    });

    it("rejects an answer pinned to a participant who is not on the submission", async () => {
      await pglite.query("DELETE FROM submissions");
      const error = await createSubmission(eventId, cfpInput({
        answers: cleanAnswersSchema.parse([
          { fieldId: titleField, participantId: missingContact, value: { t: "s", v: "Nobody" } },
        ]),
      })).catch((thrown: unknown) => thrown);
      expect(isAppError(error) && error.code).toBe("VALIDATION");
    });
  });
});
