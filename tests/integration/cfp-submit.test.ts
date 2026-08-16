import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import { scopedParticipantFieldErrorKey } from "@/features/forms/participant-errors";
import { GOLDEN_AUTHORING_ROWS, GOLDEN_SNAPSHOT } from "@/shared/fixtures/form-snapshot";
import { contactIdSchema, eventIdSchema, formIdSchema, type AnswerValue } from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";

/**
 * The *whole* migration chain, in order, rather than a hand-picked subset.
 *
 * The repository modules this file exercises read columns from across the
 * chain — `submitCfpForm`'s promotion path reads `contacts.workflow_status`,
 * which arrives in 0008 — and a subset that stops short of one of them fails
 * every test in the file with `column … does not exist`, which reads like a
 * broken fixture rather than a missing migration. Enumerating the directory
 * means the next migration is picked up by existing, not by remembering to
 * add a line here.
 */
const MIGRATIONS_DIR = fileURLToPath(new URL("../../drizzle/", import.meta.url));
const migrations = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(`${MIGRATIONS_DIR}${name}`, "utf8"));

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
const DEFAULT_PARTICIPANT_ROLES = [
  { role: "speaker", enabled: true, min: 1, max: null },
  { role: "co_speaker", enabled: true, min: null, max: null },
  { role: "moderator", enabled: false, min: null, max: null },
  { role: "panelist", enabled: false, min: null, max: null },
];

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

const { saveCfpDraft, submitCfpForm } = await import("@/features/cfp");
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
    for (const migration of migrations) await pglite.exec(migration);
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
      "INSERT INTO forms(id,event_id,context,internal_name,status,closes_at,current_version,participant_roles) VALUES($1,$2,'cfp','CFP','open', now() + interval '10 days', 1, $3::jsonb)",
      [formId, eventId, JSON.stringify(DEFAULT_PARTICIPANT_ROLES)],
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

  /**
   * Derived state, reset between tests rather than by each test's first line.
   *
   * Almost every test below opened with `DELETE FROM submissions`; three did
   * not, and silently inherited whatever the previous test left. Since the
   * shared event carries `submission_cap_per_user = 3`, that residue moved
   * those three toward the cap — so adding an `it` above one of them could
   * change what it saw. The seeded event, form, and contacts stay in
   * `beforeAll`; only what the tests themselves create is cleared here.
   */
  beforeEach(async () => {
    await pglite.query("DELETE FROM submissions");
    await pglite.query("DELETE FROM communication_logs");
    await pglite.query("DELETE FROM routing_rules");
    await pglite.query("DELETE FROM form_versions WHERE version <> 1");
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

  it("does not require or store participant answers when collection is disabled", async () => {
    await pglite.query("UPDATE forms SET collect_participants=false WHERE id=$1", [formId]);
    const abstractOnly = answers();
    for (const key of ["first_name", "last_name", "email"]) delete abstractOnly[field(key).id];

    const result = await submitCfpForm({ eventId, formId, contactId: speaker, formVersion: 1, answers: abstractOnly });
    const participantAnswers = await pglite.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM submission_answers answer
       JOIN form_fields field ON field.id=answer.field_id
       JOIN form_sections section ON section.id=field.section_id
       WHERE answer.submission_id=$1 AND section.key='participant'`,
      [result.submissionId],
    );
    expect(participantAnswers.rows[0]?.count).toBe(0);
    const participants = await pglite.query<{ contact_id: string; role: string; is_primary: boolean }>(
      "SELECT contact_id,role,is_primary FROM submission_participants WHERE submission_id=$1",
      [result.submissionId],
    );
    expect(participants.rows).toEqual([{ contact_id: speaker, role: "speaker", is_primary: true }]);
    await pglite.query("UPDATE forms SET collect_participants=true WHERE id=$1", [formId]);
  });

  it("rejects a primary participant email other than the signed-in speaker", async () => {
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

  it("keeps the configured form kind on both the draft and final submission", async () => {
    await pglite.query("UPDATE forms SET kind='session' WHERE id=$1", [formId]);
    try {
      const draft = await upsertDraft(eventId, speaker, formId, 1);
      const draftRow = await pglite.query<{ kind: string }>("SELECT kind FROM submissions WHERE id=$1", [draft.submissionId]);
      expect(draftRow.rows[0]?.kind).toBe("session");

      const submitted = await submitCfpForm({
        eventId,
        formId,
        contactId: speaker,
        formVersion: 1,
        draftSubmissionId: draft.submissionId,
        answers: answers(),
      });
      const submittedRow = await pglite.query<{ kind: string }>("SELECT kind FROM submissions WHERE id=$1", [submitted.submissionId]);
      expect(submittedRow.rows[0]?.kind).toBe("session");
    } finally {
      await pglite.query("UPDATE forms SET kind='abstract' WHERE id=$1", [formId]);
    }
  });

  it("accepts enabled canonical roles and rejects disabled roles", async () => {
    const moderatorOnly = DEFAULT_PARTICIPANT_ROLES.map((setting) => ({
      ...setting,
      enabled: setting.role === "speaker" || setting.role === "moderator",
    }));
    await pglite.query("UPDATE forms SET participant_roles=$2::jsonb WHERE id=$1", [formId, JSON.stringify(moderatorOnly)]);
    try {
      const submitted = await submitCfpForm({
        eventId,
        formId,
        contactId: speaker,
        formVersion: 1,
        answers: answers(),
        participants: [
          { clientId: "primary", email: "ada@example.com", role: "speaker", isPrimary: true, sortOrder: 0, answers: answers() },
          {
            clientId: "moderator-1",
            email: "moderator@example.com",
            role: "moderator",
            isPrimary: false,
            sortOrder: 1,
            answers: answers({ [field("email").id]: text("moderator@example.com") }),
          },
        ],
      });
      const roles = await pglite.query<{ role: string }>(
        "SELECT role FROM submission_participants WHERE submission_id=$1 ORDER BY sort_order",
        [submitted.submissionId],
      );
      expect(roles.rows.map((row) => row.role)).toEqual(["speaker", "moderator"]);

      // Mid-test reset: the assertion below is that the *rejected* attempt
      // wrote nothing, which only means something once the accepted one above
      // is cleared.
      await pglite.query("DELETE FROM submissions");
      const disabled = await submitCfpForm({
        eventId,
        formId,
        contactId: speaker,
        formVersion: 1,
        answers: answers(),
        participants: [
          { clientId: "primary", email: "ada@example.com", role: "speaker", isPrimary: true, sortOrder: 0, answers: answers() },
          {
            clientId: "co-1",
            email: "disabled-co@example.com",
            role: "co_speaker",
            isPrimary: false,
            sortOrder: 1,
            answers: answers({ [field("email").id]: text("disabled-co@example.com") }),
          },
        ],
      }).catch((thrown: unknown) => thrown);
      // FORM_VERSION_STALE rather than VALIDATION: `participant_roles` lives on
      // the `forms` row and not in the compiled snapshot, so disabling a role
      // produces a byte-identical snapshot that the version gate waves through.
      // A wizard that rendered while the role was enabled therefore hit a plain
      // VALIDATION, which it classifies as ordinary and retries forever with no
      // stale-reload path. The rejection itself is unchanged — nothing is
      // written either way — but the speaker now gets the recovery the wizard
      // already knows how to perform.
      expect(isAppError(disabled) && disabled.code).toBe("FORM_VERSION_STALE");
      expect((await pglite.query<{ count: number }>("SELECT count(*)::int AS count FROM submissions")).rows[0]?.count).toBe(0);
    } finally {
      await pglite.query("UPDATE forms SET participant_roles=$2::jsonb WHERE id=$1", [formId, JSON.stringify(DEFAULT_PARTICIPANT_ROLES)]);
    }
  });

  it("refuses a submit whose co-speakers the form no longer collects, rather than dropping them", async () => {
    // `collect_participants` is not in the snapshot either, and turning it off
    // is allowed until the form has non-draft submissions — exactly the window
    // the first submitter is in. `submittedParticipants` then collapsed to the
    // submitter alone: every co-speaker the client sent was silently discarded,
    // no participant answers were kept, `mapped.contact` was empty so first and
    // last name were never written, and the speaker saw "Thank you — your
    // submission is in".
    await pglite.query("UPDATE forms SET collect_participants=false WHERE id=$1", [formId]);
    try {
      const stale = await submitCfpForm({
        eventId,
        formId,
        contactId: speaker,
        formVersion: 1,
        answers: answers(),
        participants: [
          { clientId: "primary", email: "ada@example.com", role: "speaker", isPrimary: true, sortOrder: 0, answers: answers() },
          { clientId: "co-1", email: "grace@example.com", role: "co_speaker", isPrimary: false, sortOrder: 1, answers: answers({ [field("email").id]: text("grace@example.com") }) },
        ],
      }).catch((thrown: unknown) => thrown);
      expect(isAppError(stale) && stale.code).toBe("FORM_VERSION_STALE");
      // Carrying the fresh snapshot, which is what the wizard re-renders from.
      expect(isAppError(stale) && (stale.details as { version?: number } | undefined)?.version).toBe(1);
      expect((await pglite.query<{ count: number }>("SELECT count(*)::int AS count FROM submissions")).rows[0]?.count).toBe(0);

      // A submit that sends no participants is unaffected: that is what a form
      // which does not collect them is supposed to receive.
      const fine = await submitCfpForm({ eventId, formId, contactId: speaker, formVersion: 1, answers: answers() });
      expect(fine.submissionId).toBeTruthy();
      await pglite.query("DELETE FROM submissions");
    } finally {
      await pglite.query("UPDATE forms SET collect_participants=true WHERE id=$1", [formId]);
    }
  });

  it("scopes an additional participant's field errors to its client ID", async () => {
    const incomplete = answers({ [field("email").id]: text("incomplete@example.com") });
    delete incomplete[field("first_name").id];
    const error = await submitCfpForm({
      eventId,
      formId,
      contactId: speaker,
      formVersion: 1,
      answers: answers(),
      participants: [
        { clientId: "primary", email: "ada@example.com", role: "speaker", isPrimary: true, sortOrder: 0, answers: answers() },
        {
          clientId: "co-1",
          email: "incomplete@example.com",
          role: "co_speaker",
          isPrimary: false,
          sortOrder: 1,
          answers: incomplete,
        },
      ],
    }).catch((thrown: unknown) => thrown);

    expect(isAppError(error) && error.code).toBe("VALIDATION");
    const fieldErrors = isAppError(error)
      ? (error.details as { fieldErrors?: Record<string, string> } | undefined)?.fieldErrors
      : undefined;
    expect(fieldErrors?.[scopedParticipantFieldErrorKey("co-1", field("first_name").id)]).toContain("required");
    expect(fieldErrors?.[field("first_name").id]).toBeUndefined();
  });

  it("resolves co-speaker emails and remaps their answers to stored participants", async () => {
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

  it("does not let the submitter overwrite an existing co-speaker profile", async () => {
    const existing = contactIdSchema.parse("f0000000-0000-4000-8000-000000000006");
    await pglite.query(
      `INSERT INTO contacts(id,event_id,email,first_name,last_name,company)
       VALUES($1,$2,'existing@example.com','Existing','Speaker','Original Co')
       ON CONFLICT (event_id,email) DO UPDATE SET first_name='Existing',last_name='Speaker',company='Original Co'`,
      [existing, eventId],
    );

    await submitCfpForm({
      eventId,
      formId,
      contactId: speaker,
      formVersion: 1,
      answers: answers(),
      participants: [
        { clientId: "primary", email: "ada@example.com", role: "speaker", isPrimary: true, sortOrder: 0, answers: answers() },
        {
          clientId: "co-existing",
          email: "existing@example.com",
          role: "co_speaker",
          isPrimary: false,
          sortOrder: 1,
          answers: answers({
            [field("first_name").id]: text("Attacker"),
            [field("last_name").id]: text("Supplied"),
            [field("email").id]: text("existing@example.com"),
            [field("company").id]: text("Overwritten Co"),
          }),
        },
      ],
    });

    const profile = await pglite.query<{ first_name: string; last_name: string; company: string | null }>(
      "SELECT first_name,last_name,company FROM contacts WHERE id=$1",
      [existing],
    );
    expect(profile.rows[0]).toEqual({ first_name: "Existing", last_name: "Speaker", company: "Original Co" });
  });

  it("rejects a primary mapped email that contradicts the authenticated identity", async () => {
    const error = await submitCfpForm({
      eventId,
      formId,
      contactId: speaker,
      formVersion: 1,
      answers: answers(),
      participants: [{
        clientId: "primary",
        email: "ada@example.com",
        role: "speaker",
        isPrimary: true,
        sortOrder: 0,
        answers: answers({ [field("email").id]: text("different@example.com") }),
      }],
    }).catch((thrown: unknown) => thrown);

    expect(isAppError(error) && error.code).toBe("VALIDATION");
    expect((await pglite.query<{ count: number }>("SELECT count(*)::int AS count FROM submissions")).rows[0]?.count).toBe(0);
  });

  it("rejects a co-speaker mapped email that contradicts their canonical email", async () => {
    await pglite.query("DELETE FROM contacts WHERE email='grace@example.com'");
    const error = await submitCfpForm({
      eventId,
      formId,
      contactId: speaker,
      formVersion: 1,
      answers: answers(),
      participants: [
        { clientId: "primary", email: "ada@example.com", role: "speaker", isPrimary: true, sortOrder: 0, answers: answers() },
        {
          clientId: "co-1",
          email: "grace@example.com",
          role: "co_speaker",
          isPrimary: false,
          sortOrder: 1,
          answers: answers({ [field("email").id]: text("different@example.com") }),
        },
      ],
    }).catch((thrown: unknown) => thrown);

    expect(isAppError(error) && error.code).toBe("VALIDATION");
    expect((await pglite.query<{ count: number }>("SELECT count(*)::int AS count FROM contacts WHERE email='grace@example.com'")).rows[0]?.count).toBe(0);
    expect((await pglite.query<{ count: number }>("SELECT count(*)::int AS count FROM submissions")).rows[0]?.count).toBe(0);
  });

  it("returns an already-submitted draft without applying a changed retry payload", async () => {
    await pglite.query("DELETE FROM contacts WHERE email='retry-only@example.com'");
    const draft = await upsertDraft(eventId, speaker, formId, 1);
    const created = await submitCfpForm({
      eventId,
      formId,
      contactId: speaker,
      formVersion: 1,
      draftSubmissionId: draft.submissionId,
      answers: answers(),
    });

    const retried = await submitCfpForm({
      eventId,
      formId,
      contactId: speaker,
      formVersion: 1,
      draftSubmissionId: draft.submissionId,
      answers: answers({ [field("title").id]: text("Changed retry title") }),
      participants: [
        { clientId: "primary", email: "ada@example.com", role: "speaker", isPrimary: true, sortOrder: 0, answers: answers() },
        {
          clientId: "retry-co",
          email: "retry-only@example.com",
          role: "co_speaker",
          isPrimary: false,
          sortOrder: 1,
          answers: answers({ [field("email").id]: text("retry-only@example.com") }),
        },
      ],
    });

    expect(retried).toEqual(created);
    expect((await pglite.query<{ title: string }>("SELECT title FROM submissions WHERE id=$1", [created.submissionId])).rows[0]?.title).toBe("Caching at the edge");
    expect((await pglite.query<{ count: number }>("SELECT count(*)::int AS count FROM contacts WHERE email='retry-only@example.com'")).rows[0]?.count).toBe(0);
  });

  it("returns an already-submitted draft after the form changes structurally", async () => {
    await pglite.query("DELETE FROM contacts WHERE email='stale-retry-only@example.com'");
    const draft = await upsertDraft(eventId, speaker, formId, 1);
    const created = await submitCfpForm({
      eventId,
      formId,
      contactId: speaker,
      formVersion: 1,
      draftSubmissionId: draft.submissionId,
      answers: answers(),
    });
    const drifted = structuredClone(GOLDEN_SNAPSHOT) as typeof GOLDEN_SNAPSHOT;
    const section = drifted.sections[0];
    const template = section?.fields[0];
    if (!section || !template) throw new Error("golden abstract section missing");
    section.fields.push({
      ...template,
      id: "f0000000-0000-4000-8000-0000000000ab" as typeof template.id,
      key: "retry_required",
      required: true,
    });
    drifted.version = 2;
    await pglite.query(
      "INSERT INTO form_versions(event_id,form_id,version,snapshot) VALUES($1,$2,2,$3::jsonb)",
      [eventId, formId, JSON.stringify(drifted)],
    );
    await pglite.query("UPDATE forms SET current_version=2 WHERE id=$1", [formId]);

    const retried = await submitCfpForm({
      eventId,
      formId,
      contactId: speaker,
      formVersion: 1,
      draftSubmissionId: draft.submissionId,
      answers: {},
      participants: [
        { clientId: "primary", email: "ada@example.com", role: "speaker", isPrimary: true, sortOrder: 0, answers: {} },
        {
          clientId: "retry-co",
          email: "stale-retry-only@example.com",
          role: "co_speaker",
          isPrimary: false,
          sortOrder: 1,
          answers: {},
        },
      ],
    });

    expect(retried).toEqual(created);
    expect((await pglite.query<{ count: number }>("SELECT count(*)::int AS count FROM contacts WHERE email='stale-retry-only@example.com'")).rows[0]?.count).toBe(0);
    await pglite.query("UPDATE forms SET current_version=1 WHERE id=$1", [formId]);
  });

  it("serializes mixed draft-backed and fresh submits without deadlocking", async () => {
    const draft = await upsertDraft(eventId, speaker, formId, 1);
    const settled = await Promise.allSettled([
      submitCfpForm({
        eventId,
        formId,
        contactId: speaker,
        formVersion: 1,
        draftSubmissionId: draft.submissionId,
        answers: answers(),
      }),
      submitCfpForm({ eventId, formId, contactId: speaker, formVersion: 1, answers: answers() }),
    ]);

    expect(settled.every((result) => result.status === "fulfilled")).toBe(true);
    const rows = await pglite.query<{ count: number }>("SELECT count(*)::int AS count FROM submissions");
    // Either request may promote the one draft first; the other then either
    // observes that committed result or creates one fresh submission.
    expect(rows.rows[0]?.count).toBeGreaterThanOrEqual(1);
    expect(rows.rows[0]?.count).toBeLessThanOrEqual(2);
  }, 20_000);

  it("rejects a submitted draft ID that belongs to another speaker", async () => {
    await pglite.query("DELETE FROM contacts WHERE email IN ('owner@example.com','foreign-side-effect@example.com')");
    const owner = contactIdSchema.parse("f0000000-0000-4000-8000-000000000005");
    await pglite.query(
      "INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES($1,$2,'owner@example.com','Draft','Owner')",
      [owner, eventId],
    );
    const foreignDraft = await upsertDraft(eventId, owner, formId, 1);
    await submitCfpForm({
      eventId,
      formId,
      contactId: owner,
      formVersion: 1,
      draftSubmissionId: foreignDraft.submissionId,
      answers: answers({ [field("email").id]: text("owner@example.com") }),
    });

    const error = await submitCfpForm({
      eventId,
      formId,
      contactId: speaker,
      formVersion: 1,
      draftSubmissionId: foreignDraft.submissionId,
      answers: answers(),
      participants: [
        { clientId: "primary", email: "ada@example.com", role: "speaker", isPrimary: true, sortOrder: 0, answers: answers() },
        {
          clientId: "foreign-co",
          email: "foreign-side-effect@example.com",
          role: "co_speaker",
          isPrimary: false,
          sortOrder: 1,
          answers: answers({ [field("email").id]: text("foreign-side-effect@example.com") }),
        },
      ],
    }).catch((thrown: unknown) => thrown);

    expect(isAppError(error) && error.code).toBe("NOT_FOUND");
    expect((await pglite.query<{ count: number }>("SELECT count(*)::int AS count FROM contacts WHERE email='foreign-side-effect@example.com'")).rows[0]?.count).toBe(0);
  });

  it("uses abstract answers when evaluating participant field visibility", async () => {
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
  });

  it("writes through a contact mapping placed on an abstract-section field", async () => {
    // `createFieldIn` accepts a `contact.*` mapping on any field, and the
    // builder's Maps-to select offers every target regardless of section — but
    // `submitCfpForm` read only `mapped.submission` and dropped
    // `mapped.contact`, so an organizer who put "Job title" on the Submission
    // step watched every speaker answer it while `contacts.job_title` stayed
    // NULL forever. The portal task runtime applies the whole snapshot's
    // contact map, so the two runtimes disagreed about the same authoring
    // choice.
    //
    // The mapping moves rather than being added: every `contact.*` target is
    // already claimed by the participant section, and `assertUniqueMapsTo`
    // allows only one live field per target.
    const abstractMapped = structuredClone(GOLDEN_SNAPSHOT) as typeof GOLDEN_SNAPSHOT;
    abstractMapped.version = 7;
    const notes = abstractMapped.sections.flatMap((section) => section.fields).find((candidate) => candidate.key === "notes");
    const participantSection = abstractMapped.sections.find((candidate) => candidate.key === "participant");
    if (!notes || !participantSection) throw new Error("golden snapshot shape changed");
    notes.mapsTo = "contact.job_title";
    participantSection.fields = participantSection.fields.filter((candidate) => candidate.key !== "job_title");
    await pglite.query(
      "INSERT INTO form_versions(event_id,form_id,version,snapshot) VALUES($1,$2,7,$3::jsonb)",
      [eventId, formId, JSON.stringify(abstractMapped)],
    );

    await submitCfpForm({
      eventId,
      formId,
      contactId: speaker,
      formVersion: 7,
      answers: answers({ [notes.id]: text("Countess of Lovelace") }),
    });

    const profile = await pglite.query<{ job_title: string | null }>(
      "SELECT job_title FROM contacts WHERE id=$1", [speaker],
    );
    expect(profile.rows[0]?.job_title).toBe("Countess of Lovelace");
  });

  it("rolls back submission creation when the profile update fails", async () => {
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
    await pglite.query("DELETE FROM contacts WHERE email='draft-co@example.com'");
    // `created` is what the wizard gates its profile prefill on: seeding the
    // speaker's contact details on a resume would put back a mapped answer they
    // cleared on purpose, on every reload.
    const started = await upsertDraft(eventId, speaker, formId, 1);
    expect(started.created).toBe(true);
    await saveCfpDraft({
      eventId,
      formId,
      contactId: speaker,
      formVersion: 1,
      answers: { [field("title").id]: text("A work in progress") },
      participants: [{
        clientId: "draft-co",
        email: "draft-co@example.com",
        role: "co_speaker",
        isPrimary: false,
        sortOrder: 1,
        answers: {
          [field("first_name").id]: text("Draft"),
          [field("last_name").id]: text("Partner"),
          [field("email").id]: text("draft-co@example.com"),
        },
      }],
    });

    const resumed = await upsertDraft(eventId, speaker, formId, 1);
    expect(resumed.created).toBe(false);
    expect(resumed.answers).toEqual({ [field("title").id]: text("A work in progress") });
    expect(resumed.participants).toHaveLength(1);
    expect(resumed.participants[0]).toMatchObject({ email: "draft-co@example.com", role: "co_speaker", sortOrder: 1 });
    expect(resumed.participants[0]?.answers).toMatchObject({
      [field("first_name").id]: text("Draft"),
      [field("email").id]: text("draft-co@example.com"),
    });
  });

  it("persists enabled non-speaker draft roles and rejects disabled ones", async () => {
    const moderatorOnly = DEFAULT_PARTICIPANT_ROLES.map((setting) => ({
      ...setting,
      enabled: setting.role === "speaker" || setting.role === "moderator",
    }));
    await pglite.query("UPDATE forms SET participant_roles=$2::jsonb WHERE id=$1", [formId, JSON.stringify(moderatorOnly)]);
    try {
      await upsertDraft(eventId, speaker, formId, 1);
      await saveCfpDraft({
        eventId,
        formId,
        contactId: speaker,
        formVersion: 1,
        answers: { [field("title").id]: text("A moderated draft") },
        participants: [{
          clientId: "draft-moderator",
          email: "draft-moderator@example.com",
          role: "moderator",
          isPrimary: false,
          sortOrder: 1,
          answers: { [field("email").id]: text("draft-moderator@example.com") },
        }],
      });
      const resumed = await upsertDraft(eventId, speaker, formId, 1);
      expect(resumed.participants[0]).toMatchObject({ role: "moderator", email: "draft-moderator@example.com" });
      await upsertDraft(eventId, speaker, formId, 1);
      const disabled = await saveCfpDraft({
        eventId,
        formId,
        contactId: speaker,
        formVersion: 1,
        answers: {},
        participants: [{
          clientId: "disabled-draft-co",
          email: "disabled-draft-co@example.com",
          role: "co_speaker",
          isPrimary: false,
          sortOrder: 1,
          answers: {},
        }],
      }).catch((thrown: unknown) => thrown);
      expect(isAppError(disabled) && disabled.code).toBe("VALIDATION");
    } finally {
      await pglite.query("UPDATE forms SET participant_roles=$2::jsonb WHERE id=$1", [formId, JSON.stringify(DEFAULT_PARTICIPANT_ROLES)]);
    }
  });

  // The wizard debounces autosave, so its last PATCH can be in flight when
  // submit promotes the draft row in place. Reporting that as NOT_FOUND put a
  // 404 in the console of a speaker who had just been given their SESS code.
  it("treats an autosave that lands after submit as a no-op on the promoted row", async () => {
    const draft = await upsertDraft(eventId, speaker, formId, 1);
    const created = await submitCfpForm({
      eventId,
      formId,
      contactId: speaker,
      formVersion: 1,
      draftSubmissionId: draft.submissionId,
      answers: answers(),
    });

    const late = await saveCfpDraft({
      eventId,
      formId,
      contactId: speaker,
      formVersion: 1,
      answers: { [field("title").id]: text("A keystroke after the deadline") },
    });

    expect(late).toEqual({ submissionId: created.submissionId, saved: false });
    // The committed answers are untouched — a no-op, not a late edit.
    const stored = await pglite.query<{ value: AnswerValue }>(
      "SELECT value FROM submission_answers WHERE submission_id=$1 AND field_id=$2",
      [created.submissionId, field("title").id],
    );
    expect(stored.rows[0]?.value).toEqual(text("Caching at the edge"));
  });

  it("still refuses an autosave from a speaker with no submission for the form", async () => {
    const failure = await saveCfpDraft({
      eventId,
      formId,
      contactId: speaker,
      formVersion: 1,
      answers: { [field("title").id]: text("Nothing to write to") },
    }).catch((error: unknown) => error);

    expect(isAppError(failure) && failure.code).toBe("NOT_FOUND");
  });

  it("never stores an answer to a question the speaker could not see", async () => {
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
  });

  it("reports field errors without writing anything", async () => {
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
