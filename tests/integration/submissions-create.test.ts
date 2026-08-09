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

const eventId = eventIdSchema.parse("e0000000-0000-4000-8000-000000000001");
const openForm = formIdSchema.parse("e0000000-0000-4000-8000-000000000002");
const closedForm = formIdSchema.parse("e0000000-0000-4000-8000-000000000003");
const speaker = contactIdSchema.parse("e0000000-0000-4000-8000-000000000004");

let pglite: PGlite;
let tx: TxDb;

// withTx opens a WebSocket Pool against Neon; the seam under test is everything
// inside it, so the suite runs the same body against PGlite.
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, withTx: async (work: (handle: TxDb) => Promise<unknown>) => work(tx) };
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
    tx = drizzle(pglite, { schema }) as unknown as TxDb;

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
  }, 60_000);

  afterAll(async () => {
    await pglite.close();
  });

  it("allocates sequential codes with no gaps or duplicates", async () => {
    const codes: number[] = [];
    for (let index = 0; index < 10; index += 1) codes.push(await nextSubmissionCode(tx, eventId));
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

  it("refuses a closed form against the database clock", async () => {
    const error = await createSubmission(eventId, cfpInput({ formId: closedForm })).catch((thrown: unknown) => thrown);
    expect(isAppError(error) && error.code).toBe("FORM_CLOSED");
  });

  it("refuses once the per-user limit is used up, and drafts do not count", async () => {
    // The event cap is 2; one submission already exists from the case above.
    await upsertDraft(eventId, speaker, openForm, 1);
    const second = await createSubmission(eventId, cfpInput({ fields: { title: "Second talk" } }));
    expect(second.promotedFromDraft).toBe(true);

    const error = await createSubmission(eventId, cfpInput({ fields: { title: "Third talk" } }))
      .catch((thrown: unknown) => thrown);
    expect(isAppError(error) && error.code).toBe("LIMIT_REACHED");
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

    await createSubmission(eventId, cfpInput());
    // M14's toggle only works because the per-form flag decides here.
    expect(await countRows("communication_logs")).toBe(0);

    await pglite.query("UPDATE forms SET send_confirmation=true WHERE id=$1", [openForm]);
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
});
