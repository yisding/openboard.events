import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import {
  cleanAnswersSchema,
  contactIdSchema,
  eventIdSchema,
  fieldIdSchema,
  formIdSchema,
  sectionIdSchema,
  submissionIdSchema,
  tagIdSchema,
  trackIdSchema,
  type FormSnapshot,
} from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";

/**
 * The edit half of M18 plus M17's organizer save: `updateSubmissionFromCfp`,
 * `withdraw`, `getAcceptedForScheduling` and `updateSubmissionFields`, against a
 * real Postgres with the real migrations — including the transition trigger,
 * which is the backstop every one of these guards is layered on top of.
 */
const migration0 = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");

const eventId = eventIdSchema.parse("f0000000-0000-4000-8000-000000000001");
const openForm = formIdSchema.parse("f0000000-0000-4000-8000-000000000002");
const closedForm = formIdSchema.parse("f0000000-0000-4000-8000-000000000003");
const speaker = contactIdSchema.parse("f0000000-0000-4000-8000-000000000004");
const stranger = contactIdSchema.parse("f0000000-0000-4000-8000-000000000005");
const coSpeaker = contactIdSchema.parse("f0000000-0000-4000-8000-00000000000c");
const sectionId = sectionIdSchema.parse("f0000000-0000-4000-8000-000000000006");
const titleField = fieldIdSchema.parse("f0000000-0000-4000-8000-000000000007");
const summaryField = fieldIdSchema.parse("f0000000-0000-4000-8000-000000000008");
const trackField = fieldIdSchema.parse("f0000000-0000-4000-8000-000000000009");
const trackA = trackIdSchema.parse("f0000000-0000-4000-8000-00000000000a");
const trackB = trackIdSchema.parse("f0000000-0000-4000-8000-00000000000b");
const tagOne = tagIdSchema.parse("f0000000-0000-4000-8000-00000000000d");
const tagTwo = tagIdSchema.parse("f0000000-0000-4000-8000-00000000000e");
const formatId = "f0000000-0000-4000-8000-00000000000f";
const strayField = fieldIdSchema.parse("f0000000-0000-4000-8000-000000000010");

/** A field on the pinned snapshot but *not* on the closed form, so the two never blur. */
function field(id: ReturnType<typeof fieldIdSchema.parse>, key: string, overrides: Partial<FormSnapshot["sections"][number]["fields"][number]> = {}) {
  return {
    id,
    key,
    label: key,
    type: "text" as const,
    required: false,
    locked: false,
    maxChars: null,
    helpText: "",
    options: [],
    visibility: null,
    mapsTo: null,
    ...overrides,
  };
}

const snapshot: FormSnapshot = {
  formId: openForm,
  version: 1,
  context: "cfp",
  sections: [{
    id: sectionId,
    key: "main",
    title: "Your proposal",
    pageHeading: "Proposal",
    descriptionHtml: "",
    fields: [
      field(titleField, "title", { mapsTo: "submission.title" }),
      field(summaryField, "summary", { type: "richtext", mapsTo: "submission.description_html" }),
      field(trackField, "track", {
        type: "dropdown",
        mapsTo: "submission.track_id",
        options: [
          { id: "opt-a", label: "Track A", trackId: trackA },
          { id: "opt-b", label: "Track B", trackId: trackB },
          { id: "opt-none", label: "Undecided" },
        ],
      }),
    ],
  }],
};

let pglite: PGlite;
function createTestDb(client: PGlite) {
  return drizzle(client, { schema });
}
let testDb: ReturnType<typeof createTestDb>;

// `withTx` opens a WebSocket Pool against Neon; the seam under test is everything
// inside it, so the suite runs the same body inside a real PGlite transaction.
// `db` is redirected too, because `withdraw`, `getAcceptedForScheduling` and
// `updateSubmissionFields` deliberately do *not* open one of the eight audited
// transactions — they are single `neon-http` statements in production.
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return {
    ...actual,
    get db() {
      return testDb;
    },
    withTx: async (work: (handle: TxDb) => Promise<unknown>) => testDb.transaction(
      async (handle) => work(handle as unknown as TxDb),
    ),
  };
});

const {
  createSubmission,
  getSubmissionVocabulary,
  getAcceptedForScheduling,
  updateSubmissionFields,
  updateSubmissionFromCfp,
  withdraw,
} = await import("@/features/submissions");

const noAnswers = cleanAnswersSchema.parse([]);

async function seedSubmission(options: {
  id: string;
  status: string;
  formId?: string | null;
  submitter?: string | null;
  formVersion?: number | null;
  code: number;
}): Promise<string> {
  await pglite.query(
    `INSERT INTO submissions(id,event_id,form_id,form_version,code,status,source,submitter_contact_id,title,submitted_at)
     VALUES($1,$2,$3,$4,$5,$6,'cfp',$7,'Original title', now())`,
    [
      options.id,
      eventId,
      options.formId === undefined ? openForm : options.formId,
      options.formVersion === undefined ? 1 : options.formVersion,
      options.code,
      options.status,
      options.submitter === undefined ? speaker : options.submitter,
    ],
  );
  await pglite.query(
    "INSERT INTO submission_participants(event_id,submission_id,contact_id,role,is_primary,sort_order) VALUES($1,$2,$3,'speaker',true,0)",
    [eventId, options.id, speaker],
  );
  return options.id;
}

async function readSubmission(id: string) {
  const rows = await pglite.query<{
    title: string; description_html: string | null; track_id: string | null; status: string;
    row_version: number; capacity: number | null; notified_at: Date | null; notify_revision: number;
  }>(
    "SELECT title, description_html, track_id, status, row_version, capacity, notified_at, notify_revision FROM submissions WHERE id=$1",
    [id],
  );
  return rows.rows[0];
}

beforeAll(async () => {
  pglite = new PGlite();
  await pglite.exec(migration0);
  await pglite.exec(migration1);
  testDb = createTestDb(pglite);

  await pglite.query(
    "INSERT INTO events(id,name,slug,starts_at,ends_at) VALUES($1,'Event','edit-event','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
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
  for (const [id, email] of [[speaker, "speaker@example.com"], [stranger, "stranger@example.com"], [coSpeaker, "co@example.com"]] as const) {
    await pglite.query(
      "INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES($1,$2,$3,'Test','Person')",
      [id, eventId, email],
    );
  }
  await pglite.query("INSERT INTO form_sections(id,event_id,form_id,key) VALUES($1,$2,$3,'main')", [sectionId, eventId, openForm]);
  for (const [id, key, type] of [
    [titleField, "title", "text"],
    [summaryField, "summary", "richtext"],
    [trackField, "track", "dropdown"],
    [strayField, "stray", "text"],
  ] as const) {
    await pglite.query(
      "INSERT INTO form_fields(id,event_id,form_id,section_id,key,label,field_type) VALUES($1,$2,$3,$4,$5,$5,$6)",
      [id, eventId, openForm, sectionId, key, type],
    );
  }
  await pglite.query(
    "INSERT INTO form_versions(event_id,form_id,version,snapshot) VALUES($1,$2,1,$3)",
    [eventId, openForm, JSON.stringify(snapshot)],
  );
  for (const [id, name] of [[trackA, "Track A"], [trackB, "Track B"]] as const) {
    await pglite.query("INSERT INTO tracks(id,event_id,name) VALUES($1,$2,$3)", [id, eventId, name]);
  }
  for (const [id, name] of [[tagOne, "Tag one"], [tagTwo, "Tag two"]] as const) {
    await pglite.query("INSERT INTO tags(id,event_id,name) VALUES($1,$2,$3)", [id, eventId, name]);
  }
  await pglite.query("INSERT INTO session_formats(id,event_id,name) VALUES($1,$2,'Talk')", [formatId, eventId]);
}, 60_000);

afterAll(async () => {
  await pglite.close();
});

beforeEach(async () => {
  await pglite.query("DELETE FROM sessions");
  await pglite.query("DELETE FROM submissions");
});

describe("updateSubmissionFromCfp", () => {
  const submissionId = submissionIdSchema.parse("f1000000-0000-4000-8000-000000000001");

  function answers(trackOption: string) {
    return cleanAnswersSchema.parse([
      { fieldId: titleField, participantId: null, value: { t: "s", v: "An edited title" } },
      { fieldId: summaryField, participantId: null, value: { t: "s", v: "<p>Edited</p><script>alert(1)</script>" } },
      { fieldId: trackField, participantId: null, value: { t: "opt", v: trackOption } },
    ]);
  }

  it("writes the answers and the mapped columns, and bumps row_version", async () => {
    await seedSubmission({ id: submissionId, status: "pending", code: 1 });
    const before = await readSubmission(submissionId);

    const result = await updateSubmissionFromCfp(eventId, speaker, submissionId, answers("opt-b"));

    const after = await readSubmission(submissionId);
    expect(result.rowVersion).toBe((before?.row_version ?? 0) + 1);
    expect(after?.title).toBe("An edited title");
    // The description is public input rendered in the admin panel; it goes
    // through the sanitizer on the way in, not on the way out.
    expect(after?.description_html).not.toContain("<script");
    // An *option* id is not a vocabulary id — the track is the one the option
    // carries, and writing the option id here would be a broken foreign key.
    expect(after?.track_id).toBe(trackB);
    expect(after?.status).toBe("pending");

    const stored = await pglite.query<{ field_id: string }>(
      "SELECT field_id FROM submission_answers WHERE submission_id=$1 ORDER BY field_id",
      [submissionId],
    );
    expect(stored.rows).toHaveLength(3);
  });

  it("clears an answer the speaker removed without touching one whose field left the form", async () => {
    await seedSubmission({ id: submissionId, status: "pending", code: 1 });
    await updateSubmissionFromCfp(eventId, speaker, submissionId, answers("opt-a"));
    // A question that has since been taken off the form: its answer is not in
    // the snapshot's field list, so it survives for the organizer's
    // "no longer on this form" group.
    await pglite.query(
      "INSERT INTO submission_answers(event_id,submission_id,field_id,value) VALUES($1,$2,$3,'{\"t\":\"s\",\"v\":\"legacy\"}'::jsonb)",
      [eventId, submissionId, strayField],
    );

    await updateSubmissionFromCfp(eventId, speaker, submissionId, cleanAnswersSchema.parse([
      { fieldId: titleField, participantId: null, value: { t: "s", v: "Only a title now" } },
    ]));

    const stored = await pglite.query<{ field_id: string }>(
      "SELECT field_id FROM submission_answers WHERE submission_id=$1",
      [submissionId],
    );
    const ids = stored.rows.map((row) => row.field_id).sort();
    expect(ids).toEqual([strayField, titleField].sort());
  });

  it("never re-runs routing: a mapped option with no track leaves the stamp alone", async () => {
    await seedSubmission({ id: submissionId, status: "pending", code: 1 });
    await pglite.query("UPDATE submissions SET track_id=$1 WHERE id=$2", [trackA, submissionId]);

    await updateSubmissionFromCfp(eventId, speaker, submissionId, answers("opt-none"));

    // "Undecided" means the option is tied to no track, not "clear the track an
    // organizer routed this to".
    expect((await readSubmission(submissionId))?.track_id).toBe(trackA);
  });

  it("refuses an edit after the form closed, against the database clock", async () => {
    await seedSubmission({ id: submissionId, status: "pending", code: 1, formId: closedForm });
    await pglite.query("INSERT INTO form_versions(event_id,form_id,version,snapshot) VALUES($1,$2,1,$3) ON CONFLICT DO NOTHING", [
      eventId, closedForm, JSON.stringify({ ...snapshot, formId: closedForm }),
    ]);

    const error = await updateSubmissionFromCfp(eventId, speaker, submissionId, noAnswers).catch((thrown: unknown) => thrown);
    expect(isAppError(error) && error.code).toBe("FORM_CLOSED");
  });

  it("is NOT_FOUND for another contact — existence is never leaked", async () => {
    await seedSubmission({ id: submissionId, status: "pending", code: 1 });
    const error = await updateSubmissionFromCfp(eventId, stranger, submissionId, answers("opt-a")).catch((thrown: unknown) => thrown);
    expect(isAppError(error) && error.code).toBe("NOT_FOUND");
    expect((await readSubmission(submissionId))?.title).toBe("Original title");
  });

  it("refuses to edit a decided submission", async () => {
    await seedSubmission({ id: submissionId, status: "accepted", code: 1 });
    const error = await updateSubmissionFromCfp(eventId, speaker, submissionId, answers("opt-a")).catch((thrown: unknown) => thrown);
    expect(isAppError(error) && error.code).toBe("STALE_STATUS");
  });

  it("rejects an answer to a field this form version never had", async () => {
    await seedSubmission({ id: submissionId, status: "draft", code: 1 });
    const error = await updateSubmissionFromCfp(eventId, speaker, submissionId, cleanAnswersSchema.parse([
      { fieldId: strayField, participantId: null, value: { t: "s", v: "nope" } },
    ])).catch((thrown: unknown) => thrown);
    expect(isAppError(error) && error.code).toBe("VALIDATION");
    expect(await pglite.query("SELECT 1 FROM submission_answers WHERE submission_id=$1", [submissionId])
      .then((result) => result.rows.length)).toBe(0);
  });
});

describe("withdraw", () => {
  const submissionId = submissionIdSchema.parse("f2000000-0000-4000-8000-000000000001");

  it("withdraws the submitter's own pending submission", async () => {
    await seedSubmission({ id: submissionId, status: "pending", code: 1 });
    await withdraw(eventId, speaker, submissionId);

    const row = await readSubmission(submissionId);
    expect(row?.status).toBe("withdrawn");
    const stamped = await pglite.query<{ withdrawn_at: Date | null }>("SELECT withdrawn_at FROM submissions WHERE id=$1", [submissionId]);
    // The trigger stamps the timestamp; the application does not duplicate it.
    expect(stamped.rows[0]?.withdrawn_at).not.toBeNull();
  });

  it("is NOT_FOUND for somebody else's submission, and changes nothing", async () => {
    await seedSubmission({ id: submissionId, status: "pending", code: 1 });
    const error = await withdraw(eventId, stranger, submissionId).catch((thrown: unknown) => thrown);
    expect(isAppError(error) && error.code).toBe("NOT_FOUND");
    expect((await readSubmission(submissionId))?.status).toBe("pending");
  });

  it("clears the notification when withdrawing after acceptance, and bumps the revision", async () => {
    await seedSubmission({ id: submissionId, status: "accepted", code: 1 });
    await pglite.query("UPDATE submissions SET notified_at=now() WHERE id=$1", [submissionId]);

    await withdraw(eventId, speaker, submissionId);

    const row = await readSubmission(submissionId);
    // Leaving a final state must clear and bump together, or a later re-notify
    // would be swallowed as a duplicate of the email already sent.
    expect(row?.notified_at).toBeNull();
    expect(row?.notify_revision).toBe(1);
  });

  it("refuses the transitions the matrix has no edge for", async () => {
    await seedSubmission({ id: submissionId, status: "declined", code: 1 });
    const declined = await withdraw(eventId, speaker, submissionId).catch((thrown: unknown) => thrown);
    expect(isAppError(declined) && declined.code).toBe("NOT_FOUND");
    expect((await readSubmission(submissionId))?.status).toBe("declined");

    await pglite.query("DELETE FROM submissions");
    await seedSubmission({ id: submissionId, status: "pending", code: 2 });
    await withdraw(eventId, speaker, submissionId);
    // A second withdrawal matches zero rows rather than raising the trigger's
    // 23514 as a 500.
    const twice = await withdraw(eventId, speaker, submissionId).catch((thrown: unknown) => thrown);
    expect(isAppError(twice) && twice.code).toBe("NOT_FOUND");
  });
});

describe("getAcceptedForScheduling", () => {
  const acceptedId = submissionIdSchema.parse("f3000000-0000-4000-8000-000000000001");
  const otherId = submissionIdSchema.parse("f3000000-0000-4000-8000-000000000002");

  it("returns accepted rows with their speakers and skips everything else", async () => {
    await seedSubmission({ id: acceptedId, status: "accepted", code: 1 });
    await seedSubmission({ id: otherId, status: "pending", code: 2 });
    await pglite.query(
      "INSERT INTO submission_participants(event_id,submission_id,contact_id,role,is_primary,sort_order) VALUES($1,$2,$3,'co_speaker',false,1)",
      [eventId, acceptedId, coSpeaker],
    );

    const rows = await getAcceptedForScheduling(eventId);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.submissionId).toBe(acceptedId);
    expect(rows[0]?.code).toBe(1);
    expect(rows[0]?.alreadyPromoted).toBe(false);
    expect(rows[0]?.speakers.map((person) => person.isPrimary)).toEqual([true, false]);
  });

  it("flips alreadyPromoted once a session exists for the submission", async () => {
    await seedSubmission({ id: acceptedId, status: "accepted", code: 1 });
    await pglite.query(
      "INSERT INTO sessions(event_id,submission_id,title,slug) VALUES($1,$2,'Promoted','promoted')",
      [eventId, acceptedId],
    );

    const rows = await getAcceptedForScheduling(eventId);
    expect(rows[0]?.alreadyPromoted).toBe(true);
  });

  it("returns an empty speaker list rather than null for a submission with nobody on it", async () => {
    await pglite.query(
      `INSERT INTO submissions(id,event_id,code,status,source,title) VALUES($1,$2,9,'accepted','manual','Orphan')`,
      [acceptedId, eventId],
    );
    const rows = await getAcceptedForScheduling(eventId);
    expect(rows[0]?.speakers).toEqual([]);
  });
});

describe("updateSubmissionFields", () => {
  const submissionId = submissionIdSchema.parse("f4000000-0000-4000-8000-000000000001");

  it("applies only the keys the patch carries and returns the new row_version", async () => {
    await seedSubmission({ id: submissionId, status: "pending", code: 1 });
    await pglite.query("UPDATE submissions SET description_html='<p>kept</p>' WHERE id=$1", [submissionId]);
    const before = await readSubmission(submissionId);

    const result = await updateSubmissionFields(
      eventId,
      submissionId,
      { title: "Renamed", capacity: 120 },
      before?.row_version ?? 1,
    );

    const after = await readSubmission(submissionId);
    expect(result.rowVersion).toBe((before?.row_version ?? 0) + 1);
    expect(after?.title).toBe("Renamed");
    expect(after?.capacity).toBe(120);
    // A patch is a patch: a field the drawer never sent is not blanked.
    expect(after?.description_html).toBe("<p>kept</p>");
  });

  it("sanitizes the description on write", async () => {
    await seedSubmission({ id: submissionId, status: "pending", code: 1 });
    const before = await readSubmission(submissionId);
    await updateSubmissionFields(
      eventId,
      submissionId,
      { descriptionHtml: "<p>ok</p><img src=x onerror=alert(1)>" },
      before?.row_version ?? 1,
    );
    expect((await readSubmission(submissionId))?.description_html).not.toContain("onerror");
  });

  it("rejects a stale save with STALE_WRITE and writes nothing", async () => {
    await seedSubmission({ id: submissionId, status: "pending", code: 1 });
    const before = await readSubmission(submissionId);
    const stale = before?.row_version ?? 1;

    await updateSubmissionFields(eventId, submissionId, { title: "First writer wins" }, stale);
    const error = await updateSubmissionFields(eventId, submissionId, { title: "Second writer" }, stale)
      .catch((thrown: unknown) => thrown);

    expect(isAppError(error) && error.code).toBe("STALE_WRITE");
    expect((await readSubmission(submissionId))?.title).toBe("First writer wins");
  });

  it("reconciles tags inside the same guarded statement", async () => {
    await seedSubmission({ id: submissionId, status: "pending", code: 1 });
    await pglite.query("INSERT INTO submission_tags(event_id,submission_id,tag_id) VALUES($1,$2,$3)", [eventId, submissionId, tagOne]);
    const before = await readSubmission(submissionId);

    await updateSubmissionFields(eventId, submissionId, { tagIds: [tagTwo] }, before?.row_version ?? 1);
    const tags = await pglite.query<{ tag_id: string }>("SELECT tag_id FROM submission_tags WHERE submission_id=$1", [submissionId]);
    expect(tags.rows.map((row) => row.tag_id)).toEqual([tagTwo]);

    // An empty array is "remove them all"; leaving the key out is "do not touch".
    const next = await readSubmission(submissionId);
    await updateSubmissionFields(eventId, submissionId, { tagIds: [] }, next?.row_version ?? 1);
    expect((await pglite.query("SELECT 1 FROM submission_tags WHERE submission_id=$1", [submissionId])).rows).toHaveLength(0);
  });

  it("does not write tags for a save that lost the row_version race", async () => {
    await seedSubmission({ id: submissionId, status: "pending", code: 1 });
    const before = await readSubmission(submissionId);
    const stale = before?.row_version ?? 1;
    await updateSubmissionFields(eventId, submissionId, { title: "Winner" }, stale);

    await updateSubmissionFields(eventId, submissionId, { tagIds: [tagOne, tagTwo] }, stale).catch(() => undefined);

    // The tag CTEs are driven by the guarded UPDATE's returned rows, so a losing
    // save cannot leave tags behind as evidence of a change that never happened.
    expect((await pglite.query("SELECT 1 FROM submission_tags WHERE submission_id=$1", [submissionId])).rows).toHaveLength(0);
  });

  it("is NOT_FOUND for a submission in another event", async () => {
    const otherEvent = eventIdSchema.parse("f5000000-0000-4000-8000-000000000001");
    await pglite.query(
      "INSERT INTO events(id,name,slug,starts_at,ends_at) VALUES($1,'Other','other-edit','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z') ON CONFLICT DO NOTHING",
      [otherEvent],
    );
    await seedSubmission({ id: submissionId, status: "pending", code: 1 });
    const error = await updateSubmissionFields(otherEvent, submissionId, { title: "Nope" }, 1)
      .catch((thrown: unknown) => thrown);
    expect(isAppError(error) && error.code).toBe("NOT_FOUND");
  });

  it("refuses a title longer than the column", async () => {
    await seedSubmission({ id: submissionId, status: "pending", code: 1 });
    const error = await updateSubmissionFields(eventId, submissionId, { title: "x".repeat(256) }, 1)
      .catch((thrown: unknown) => thrown);
    expect(isAppError(error) && error.code).toBe("VALIDATION");
  });
});

describe("manual create", () => {
  it("writes a formless organizer row with tags, no deadline check and no email", async () => {
    // The exact argument shape `POST /api/internal/submissions/[eventId]` builds.
    const result = await createSubmission(eventId, {
      formId: null,
      formVersion: null,
      source: "manual",
      kind: "abstract",
      initialStatus: "pending",
      submitterContactId: null,
      participants: [],
      answers: noAnswers,
      enforce: { deadline: false, limit: false },
      sendConfirmation: false,
      tagIds: [tagOne],
      fields: { title: "Invited keynote", descriptionHtml: null, trackId: trackA, capacity: 400 },
    });

    expect(result.code).toBeGreaterThan(0);
    expect(result.promotedFromDraft).toBe(false);
    const row = await readSubmission(result.submissionId);
    expect(row?.status).toBe("pending");
    expect(row?.track_id).toBe(trackA);
    // Nobody submitted it, so nobody is confirmed it was received.
    expect((await pglite.query("SELECT 1 FROM communication_logs")).rows).toHaveLength(0);
    const tags = await pglite.query<{ tag_id: string }>("SELECT tag_id FROM submission_tags WHERE submission_id=$1", [result.submissionId]);
    expect(tags.rows.map((tag) => tag.tag_id)).toEqual([tagOne]);
  });
});

describe("getSubmissionVocabulary", () => {
  it("returns this event's tracks, formats and tags in one round trip", async () => {
    const vocabulary = await getSubmissionVocabulary(eventId);
    expect(vocabulary.tracks.map((track) => track.name)).toEqual(["Track A", "Track B"]);
    expect(vocabulary.formats.map((format) => format.name)).toEqual(["Talk"]);
    expect(vocabulary.tags.map((tag) => tag.name)).toEqual(["Tag one", "Tag two"]);
  });

  it("offers nothing from another event", async () => {
    const otherEvent = eventIdSchema.parse("f6000000-0000-4000-8000-000000000001");
    await pglite.query(
      "INSERT INTO events(id,name,slug,starts_at,ends_at) VALUES($1,'Other','vocab-other','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z') ON CONFLICT DO NOTHING",
      [otherEvent],
    );
    const vocabulary = await getSubmissionVocabulary(otherEvent);
    expect(vocabulary).toEqual({ tracks: [], formats: [], tags: [] });
  });
});
