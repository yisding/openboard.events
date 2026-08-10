import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import { GOLDEN_AUTHORING_ROWS, GOLDEN_SNAPSHOT } from "@/shared/fixtures/form-snapshot";
import { contactIdSchema, eventIdSchema, formIdSchema, type AnswerValue } from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";

const migration0 = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");

const eventId = eventIdSchema.parse("f0000000-0000-4000-8000-000000000001");
const formId = formIdSchema.parse(GOLDEN_SNAPSHOT.formId);
const speaker = contactIdSchema.parse("f0000000-0000-4000-8000-000000000003");
// The vocabulary ids live on the fixture's own options — an answer is an option
// id, and the option is what records which track it stands for.
const optionsOf = (key: string) =>
  GOLDEN_SNAPSHOT.sections.flatMap((section) => section.fields).find((candidate) => candidate.key === key)?.options ?? [];
const TRACKS = optionsOf("track");
const FORMATS = optionsOf("format");
const TAGS = optionsOf("topics");
const trackId = TRACKS.find((option) => option.id === "platforms")?.trackId ?? "";
const tagId = TAGS[0]?.tagId ?? "";

let pglite: PGlite;
let tx: TxDb;

async function runInTransaction<T>(work: (handle: TxDb) => Promise<T>): Promise<T> {
  return (tx as unknown as { transaction: (callback: (handle: TxDb) => Promise<T>) => Promise<T> }).transaction(work);
}

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return {
    ...actual,
    db: new Proxy({}, { get: (_target, property) => Reflect.get(tx as object, property, tx) }),
    withTx: runInTransaction,
  };
});

const { saveCfpDraft, submitCfpForm } = await import("@/features/forms/server/submit");
const { upsertDraft } = await import("@/features/submissions");

const field = (key: string) => {
  const found = GOLDEN_SNAPSHOT.sections.flatMap((section) => section.fields).find((candidate) => candidate.key === key);
  if (!found) throw new Error(`no field ${key}`);
  return found;
};

const text = (v: string): AnswerValue => ({ t: "s", v });
const option = (v: string): AnswerValue => ({ t: "opt", v });
const multi = (v: string[]): AnswerValue => ({ t: "opts", v });

function answers(overrides: Record<string, AnswerValue> = {}): Record<string, AnswerValue> {
  return {
    [field("title").id]: text("Caching at the edge"),
    [field("description").id]: text("<p>How we made it fast</p>"),
    [field("track").id]: option("platforms"),
    [field("format").id]: option("talk"),
    [field("first_name").id]: text("Ada"),
    [field("last_name").id]: text("Lovelace"),
    [field("email").id]: text("ada@example.com"),
    ...overrides,
  };
}

describe("CFP submit, end to end through the server path", () => {
  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migration0);
    await pglite.exec(migration1);
    tx = drizzle(pglite, { schema }) as unknown as TxDb;

    await pglite.query(
      "INSERT INTO events(id,name,slug,starts_at,ends_at,submission_cap_per_user) VALUES($1,'Event','event','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z',3)",
      [eventId],
    );
    for (const option of TRACKS) {
      if (option.trackId) await pglite.query("INSERT INTO tracks(id,event_id,name) VALUES($1,$2,$3)", [option.trackId, eventId, option.label]);
    }
    for (const option of FORMATS) {
      if (option.formatId) await pglite.query("INSERT INTO session_formats(id,event_id,name) VALUES($1,$2,$3)", [option.formatId, eventId, option.label]);
    }
    for (const option of TAGS) {
      if (option.tagId) await pglite.query("INSERT INTO tags(id,event_id,name) VALUES($1,$2,$3)", [option.tagId, eventId, option.label]);
    }
    await pglite.query(
      "INSERT INTO forms(id,event_id,context,internal_name,status,closes_at,current_version) VALUES($1,$2,'cfp','CFP','open', now() + interval '10 days', 1)",
      [formId, eventId],
    );
    // submission_answers references form_fields, so the authoring rows the
    // snapshot was compiled from have to exist too — a snapshot is a copy of
    // them, not a replacement for them.
    for (const section of GOLDEN_AUTHORING_ROWS.sections) {
      await pglite.query(
        "INSERT INTO form_sections(id,event_id,form_id,key,title,page_heading,description_html,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [section.id, eventId, formId, section.key, section.title, section.pageHeading, section.descriptionHtml, section.sortOrder],
      );
    }
    for (const authored of GOLDEN_AUTHORING_ROWS.fields) {
      await pglite.query(
        `INSERT INTO form_fields(id,event_id,form_id,section_id,key,label,field_type,required,locked,max_chars,help_text,options,visibility,maps_to,sort_order)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15)`,
        [
          authored.id, eventId, formId, authored.sectionId, authored.key, authored.label, authored.fieldType,
          authored.required, authored.locked, authored.maxChars, authored.helpText,
          JSON.stringify(authored.options), authored.visibility ? JSON.stringify(authored.visibility) : null,
          authored.mapsTo, authored.sortOrder,
        ],
      );
    }
    await pglite.query(
      "INSERT INTO form_versions(event_id,form_id,version,snapshot) VALUES($1,$2,1,$3::jsonb)",
      [eventId, formId, JSON.stringify(GOLDEN_SNAPSHOT)],
    );
    await pglite.query(
      "INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES($1,$2,'ada@example.com','Ada','Lovelace')",
      [speaker, eventId],
    );
  }, 60_000);

  afterAll(async () => {
    await pglite.close();
  });

  it("stores a submission with its answers and one confirmation email", async () => {
    const result = await submitCfpForm({ eventId, formId, contactId: speaker, formVersion: 1, answers: answers() });

    expect(result.code).toBeGreaterThan(0);
    expect(result.status).toBe("pending");

    const rows = await pglite.query<{ title: string; form_version: number }>(
      "SELECT title, form_version FROM submissions WHERE id=$1",
      [result.submissionId],
    );
    // deriveMappedFields put the mapped answer into the typed column.
    expect(rows.rows[0]?.title).toBe("Caching at the edge");
    expect(rows.rows[0]?.form_version).toBe(1);

    const answerRows = await pglite.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM submission_answers WHERE submission_id=$1",
      [result.submissionId],
    );
    expect(answerRows.rows[0]?.count).toBe(7);

    const emails = await pglite.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM communication_logs WHERE template_key='submission_received'",
    );
    expect(emails.rows[0]?.count).toBe(1);
  });

  it("stores participant answers on the primary participant and updates their profile", async () => {
    await pglite.query("DELETE FROM submissions");
    await pglite.query("UPDATE contacts SET first_name='', last_name='' WHERE id=$1", [speaker]);
    const result = await submitCfpForm({
      eventId,
      formId,
      contactId: speaker,
      formVersion: 1,
      answers: answers({ [field("first_name").id]: text("Grace"), [field("last_name").id]: text("Hopper") }),
    });

    const participantAnswer = await pglite.query<{ participant_id: string | null; contact_id: string }>(
      `SELECT a.participant_id, p.contact_id
       FROM submission_answers a
       JOIN submission_participants p ON p.id=a.participant_id
       WHERE a.submission_id=$1 AND a.field_id=$2`,
      [result.submissionId, field("first_name").id],
    );
    expect(participantAnswer.rows[0]).toMatchObject({ contact_id: speaker });
    expect(participantAnswer.rows[0]?.participant_id).not.toBeNull();

    const profile = await pglite.query<{ first_name: string; last_name: string }>(
      "SELECT first_name,last_name FROM contacts WHERE id=$1",
      [speaker],
    );
    expect(profile.rows[0]).toEqual({ first_name: "Grace", last_name: "Hopper" });
  });

  it("rejects a primary participant email other than the signed-in speaker", async () => {
    await pglite.query("DELETE FROM submissions");
    const otherContact = contactIdSchema.parse("f0000000-0000-4000-8000-000000000004");
    await pglite.query(
      "INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES($1,$2,'other@example.com','Other','Speaker') ON CONFLICT DO NOTHING",
      [otherContact, eventId],
    );

    const error = await submitCfpForm({
      eventId,
      formId,
      contactId: speaker,
      formVersion: 1,
      answers: answers(),
      participants: [{ clientId: "primary", email: "other@example.com", role: "speaker", isPrimary: true, sortOrder: 0, answers: answers() }],
    }).catch((thrown: unknown) => thrown);

    expect(isAppError(error) && error.code).toBe("FORBIDDEN");
    const rows = await pglite.query<{ count: number }>("SELECT count(*)::int AS count FROM submissions");
    expect(rows.rows[0]?.count).toBe(0);
  });

  it("resolves co-speaker emails and remaps their answers to stored participants", async () => {
    await pglite.query("DELETE FROM submissions");
    await pglite.query("DELETE FROM contacts WHERE email='grace@example.com'");

    const result = await submitCfpForm({
      eventId,
      formId,
      contactId: speaker,
      formVersion: 1,
      answers: answers(),
      participants: [
        {
          clientId: "primary",
          email: "ada@example.com",
          role: "speaker",
          isPrimary: true,
          sortOrder: 0,
          answers: answers(),
        },
        {
          clientId: "co-1",
          email: " Grace@Example.com ",
          role: "co_speaker",
          isPrimary: false,
          sortOrder: 1,
          answers: answers({
            [field("first_name").id]: text("Grace"),
            [field("last_name").id]: text("Hopper"),
            [field("email").id]: text("grace@example.com"),
          }),
        },
      ],
    });

    const participants = await pglite.query<{ email: string; role: string; is_primary: boolean }>(
      `SELECT c.email, p.role, p.is_primary
       FROM submission_participants p
       JOIN contacts c ON c.id=p.contact_id
       WHERE p.submission_id=$1
       ORDER BY p.sort_order`,
      [result.submissionId],
    );
    expect(participants.rows).toEqual([
      { email: "ada@example.com", role: "speaker", is_primary: true },
      { email: "grace@example.com", role: "co_speaker", is_primary: false },
    ]);

    const coSpeakerAnswer = await pglite.query<{ email: string; value: { t: string; v: string } }>(
      `SELECT c.email, a.value
       FROM submission_answers a
       JOIN submission_participants p ON p.id=a.participant_id
       JOIN contacts c ON c.id=p.contact_id
       WHERE a.submission_id=$1 AND a.field_id=$2 AND c.email='grace@example.com'`,
      [result.submissionId, field("first_name").id],
    );
    expect(coSpeakerAnswer.rows[0]).toEqual({ email: "grace@example.com", value: { t: "s", v: "Grace" } });
  });

  it("uses abstract answers when evaluating participant field visibility", async () => {
    await pglite.query("DELETE FROM submissions");
    const crossSection = structuredClone(GOLDEN_SNAPSHOT) as typeof GOLDEN_SNAPSHOT;
    crossSection.version = 2;
    const company = crossSection.sections.flatMap((section) => section.fields).find((candidate) => candidate.key === "company");
    if (!company) throw new Error("company field missing");
    company.visibility = { match: "all", conditions: [{ sourceFieldId: field("format").id, op: "eq", value: "workshop" }] };
    await pglite.query(
      "INSERT INTO form_versions(event_id,form_id,version,snapshot) VALUES($1,$2,2,$3::jsonb)",
      [eventId, formId, JSON.stringify(crossSection)],
    );

    const result = await submitCfpForm({
      eventId,
      formId,
      contactId: speaker,
      formVersion: 2,
      answers: answers({ [field("format").id]: option("workshop"), [field("company").id]: text("Analytical Engines") }),
    });
    const stored = await pglite.query<{ value: { v: string } }>(
      "SELECT value FROM submission_answers WHERE submission_id=$1 AND field_id=$2",
      [result.submissionId, field("company").id],
    );
    expect(stored.rows[0]?.value.v).toBe("Analytical Engines");

    await pglite.query("DELETE FROM submissions");
    await pglite.query("DELETE FROM form_versions WHERE version=2");
  });

  it("rolls back submission creation when the profile update fails", async () => {
    await pglite.query("DELETE FROM submissions");
    await pglite.query("DELETE FROM communication_logs");
    await pglite.query("ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_reject_test_name");
    await pglite.query("ALTER TABLE contacts ADD CONSTRAINT contacts_reject_test_name CHECK (first_name <> 'ROLLBACK')");

    await expect(submitCfpForm({
      eventId,
      formId,
      contactId: speaker,
      formVersion: 1,
      answers: answers({ [field("first_name").id]: text("ROLLBACK") }),
    })).rejects.toThrow();

    const submissions = await pglite.query<{ count: number }>("SELECT count(*)::int AS count FROM submissions");
    const emails = await pglite.query<{ count: number }>("SELECT count(*)::int AS count FROM communication_logs");
    expect(submissions.rows[0]?.count).toBe(0);
    expect(emails.rows[0]?.count).toBe(0);
    await pglite.query("ALTER TABLE contacts DROP CONSTRAINT contacts_reject_test_name");
  });

  it("persists incomplete draft answers and returns them when the draft is resumed", async () => {
    await pglite.query("DELETE FROM submissions");
    await upsertDraft(eventId, speaker, formId, 1);
    await saveCfpDraft({
      eventId,
      formId,
      contactId: speaker,
      formVersion: 1,
      answers: { [field("title").id]: text("A work in progress") },
    });

    const resumed = await upsertDraft(eventId, speaker, formId, 1);
    expect(resumed.answers).toEqual({ [field("title").id]: text("A work in progress") });
  });

  it("never stores an answer to a question the speaker could not see", async () => {
    await pglite.query("DELETE FROM submissions");
    const result = await submitCfpForm({
      eventId,
      formId,
      contactId: speaker,
      formVersion: 1,
      // Workshop duration answered, then the format switched back to Talk.
      answers: answers({ [field("workshop_duration").id]: text("90 minutes") }),
    });

    const stored = await pglite.query<{ field_id: string }>(
      "SELECT field_id FROM submission_answers WHERE submission_id=$1",
      [result.submissionId],
    );
    expect(stored.rows.map((row) => row.field_id)).not.toContain(field("workshop_duration").id);
  });

  it("applies a routing rule to the stored track and tags", async () => {
    await pglite.query("DELETE FROM submissions");
    await pglite.query(
      `INSERT INTO routing_rules(event_id,form_id,sort_order,match,conditions,set_track_id,add_tag_ids,enabled)
       VALUES($1,$2,0,'all',$3::jsonb,$4,ARRAY[$5]::uuid[],true)`,
      [eventId, formId, JSON.stringify([{ sourceFieldId: field("format").id, op: "eq", value: "workshop" }]), trackId, tagId],
    );

    const result = await submitCfpForm({
      eventId,
      formId,
      contactId: speaker,
      formVersion: 1,
      answers: answers({ [field("format").id]: option("workshop"), [field("workshop_duration").id]: text("90 minutes") }),
    });

    const rows = await pglite.query<{ track_id: string | null }>("SELECT track_id FROM submissions WHERE id=$1", [result.submissionId]);
    expect(rows.rows[0]?.track_id).toBe(trackId);
    const tags = await pglite.query<{ tag_id: string }>("SELECT tag_id FROM submission_tags WHERE submission_id=$1", [result.submissionId]);
    expect(tags.rows.map((row) => row.tag_id)).toEqual([tagId]);

    await pglite.query("DELETE FROM routing_rules");
  });

  it("returns FORM_VERSION_STALE with the fresh snapshot when the form changed structurally", async () => {
    // A new required field is exactly the change a half-filled wizard cannot
    // survive, so the client gets the current snapshot to remap against.
    const drifted = structuredClone(GOLDEN_SNAPSHOT) as typeof GOLDEN_SNAPSHOT;
    const section = drifted.sections[0];
    const template = section?.fields[0];
    if (section && template) {
      section.fields.push({ ...template, id: "f0000000-0000-4000-8000-0000000000aa" as typeof template.id, key: "new_required", required: true });
    }
    drifted.version = 2;
    await pglite.query("INSERT INTO form_versions(event_id,form_id,version,snapshot) VALUES($1,$2,2,$3::jsonb)", [eventId, formId, JSON.stringify(drifted)]);

    const error = await submitCfpForm({ eventId, formId, contactId: speaker, formVersion: 1, answers: answers() })
      .catch((thrown: unknown) => thrown);

    expect(isAppError(error) && error.code).toBe("FORM_VERSION_STALE");
    const details = isAppError(error) ? error.details as { version: number } : null;
    expect(details?.version).toBe(2);

    await pglite.query("DELETE FROM form_versions WHERE version=2");
  });

  it("reports field errors without writing anything", async () => {
    await pglite.query("DELETE FROM submissions");
    const incomplete = answers();
    delete incomplete[field("title").id];

    const error = await submitCfpForm({ eventId, formId, contactId: speaker, formVersion: 1, answers: incomplete })
      .catch((thrown: unknown) => thrown);

    expect(isAppError(error) && error.code).toBe("VALIDATION");
    const rows = await pglite.query<{ count: number }>("SELECT count(*)::int AS count FROM submissions");
    expect(rows.rows[0]?.count).toBe(0);
  });

  it("refuses a version that was never published", async () => {
    const error = await submitCfpForm({ eventId, formId, contactId: speaker, formVersion: 99, answers: answers() })
      .catch((thrown: unknown) => thrown);
    expect(isAppError(error) && error.code).toBe("FORM_VERSION_STALE");
  });

  it("stores multi-select answers as given", async () => {
    await pglite.query("DELETE FROM submissions");
    const result = await submitCfpForm({
      eventId,
      formId,
      contactId: speaker,
      formVersion: 1,
      answers: answers({ [field("topics").id]: multi(["evals", "safety"]) }),
    });
    const rows = await pglite.query<{ value: { v: string[] } }>(
      "SELECT value FROM submission_answers WHERE submission_id=$1 AND field_id=$2",
      [result.submissionId, field("topics").id],
    );
    expect(rows.rows[0]?.value.v).toEqual(["evals", "safety"]);
  });
});
