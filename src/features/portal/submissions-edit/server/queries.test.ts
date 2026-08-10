import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import {
  contactIdSchema,
  eventIdSchema,
  fieldIdSchema,
  formIdSchema,
  sectionIdSchema,
  submissionIdSchema,
  trackIdSchema,
  type FormSnapshot,
} from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";

/**
 * M41 — the speaker's own edit-until-close, against a real Postgres (PGlite)
 * with the real migrations. `getEditableSubmission` is exercised directly
 * against the handle (no mock needed); `applySubmissionEdit` goes through
 * M18's `updateSubmissionFromCfp`, which is bound to the module-level `db` and
 * `withTx`, so those are redirected here the same way `submissions-edit.test.ts`
 * redirects them for that same function.
 */
const migration0 = readFileSync(new URL("../../../../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../../../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");

const eventId = eventIdSchema.parse("e1000000-0000-4000-8000-000000000001");
const openForm = formIdSchema.parse("e1000000-0000-4000-8000-000000000002");
const closedForm = formIdSchema.parse("e1000000-0000-4000-8000-000000000003");
const speaker = contactIdSchema.parse("e1000000-0000-4000-8000-000000000004");
const stranger = contactIdSchema.parse("e1000000-0000-4000-8000-000000000005");
const coSpeaker = contactIdSchema.parse("e1000000-0000-4000-8000-000000000006");
const mainSectionId = sectionIdSchema.parse("e1000000-0000-4000-8000-000000000007");
const participantSectionId = sectionIdSchema.parse("e1000000-0000-4000-8000-000000000008");
const titleField = fieldIdSchema.parse("e1000000-0000-4000-8000-000000000009");
const trackField = fieldIdSchema.parse("e1000000-0000-4000-8000-00000000000a");
const bioField = fieldIdSchema.parse("e1000000-0000-4000-8000-00000000000b");
const strayField = fieldIdSchema.parse("e1000000-0000-4000-8000-00000000000c");
const trackA = trackIdSchema.parse("e1000000-0000-4000-8000-00000000000d");
const trackB = trackIdSchema.parse("e1000000-0000-4000-8000-00000000000e");

const snapshot: FormSnapshot = {
  formId: openForm,
  version: 1,
  context: "cfp",
  sections: [
    {
      id: mainSectionId, key: "main", title: "Your proposal", pageHeading: "Proposal", descriptionHtml: "",
      fields: [
        {
          id: titleField, key: "title", label: "Title", type: "text", required: true, locked: false,
          maxChars: null, helpText: "", options: [], visibility: null, mapsTo: "submission.title",
        },
        {
          id: trackField, key: "track", label: "Track", type: "dropdown", required: false, locked: false,
          maxChars: null, helpText: "", visibility: null, mapsTo: "submission.track_id",
          options: [
            { id: "opt-a", label: "Track A", trackId: trackA },
            { id: "opt-b", label: "Track B", trackId: trackB },
            { id: "opt-none", label: "Undecided" },
          ],
        },
      ],
    },
    // The co-speaker roster's section — out of scope for this module's edit
    // surface (see `isParticipantSection`), so the tests below prove its
    // answers survive an abstract-only edit untouched.
    {
      id: participantSectionId, key: "participant", title: "Speakers", pageHeading: "Speakers", descriptionHtml: "",
      fields: [
        {
          id: bioField, key: "bio", label: "Bio", type: "richtext", required: false, locked: false,
          maxChars: null, helpText: "", options: [], visibility: null, mapsTo: "contact.bio_html",
        },
      ],
    },
  ],
};

let pglite: PGlite;
function createTestDb(client: PGlite) {
  return drizzle(client, { schema });
}
let testDb: ReturnType<typeof createTestDb>;

// `updateSubmissionFromCfp` (M18) opens its own `withTx` against the module-level
// `db`/`withTx` bindings; redirecting them is what lets `applySubmissionEdit`
// exercise the real mutation inside this suite's PGlite transaction.
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

const { applySubmissionEdit, getEditableSubmission } = await import("./queries");

async function seedSubmission(options: { id: string; status: string; formId?: string; code: number; withCoSpeaker?: boolean }): Promise<void> {
  await pglite.query(
    `INSERT INTO submissions(id,event_id,form_id,form_version,code,status,source,submitter_contact_id,title,track_id,submitted_at)
     VALUES($1,$2,$3,1,$4,$5,'cfp',$6,'Original title',$7, now())`,
    [options.id, eventId, options.formId ?? openForm, options.code, options.status, speaker, trackA],
  );
  await pglite.query(
    "INSERT INTO submission_participants(event_id,submission_id,contact_id,role,is_primary,sort_order) VALUES($1,$2,$3,'speaker',true,0)",
    [eventId, options.id, speaker],
  );
  await pglite.query(
    "INSERT INTO submission_answers(event_id,submission_id,field_id,participant_id,value) VALUES($1,$2,$3,NULL,'{\"t\":\"s\",\"v\":\"Original title\"}'::jsonb)",
    [eventId, options.id, titleField],
  );
  await pglite.query(
    "INSERT INTO submission_answers(event_id,submission_id,field_id,participant_id,value) VALUES($1,$2,$3,NULL,'{\"t\":\"opt\",\"v\":\"opt-a\"}'::jsonb)",
    [eventId, options.id, trackField],
  );
  if (options.withCoSpeaker) {
    const participantRow = await pglite.query<{ id: string }>(
      "INSERT INTO submission_participants(event_id,submission_id,contact_id,role,is_primary,sort_order) VALUES($1,$2,$3,'co_speaker',false,1) RETURNING id",
      [eventId, options.id, coSpeaker],
    );
    const participantId = participantRow.rows[0]?.id;
    await pglite.query(
      "INSERT INTO submission_answers(event_id,submission_id,field_id,participant_id,value) VALUES($1,$2,$3,$4,'{\"t\":\"s\",\"v\":\"<p>Co-speaker bio</p>\"}'::jsonb)",
      [eventId, options.id, bioField, participantId],
    );
  }
}

async function readSubmission(id: string) {
  const rows = await pglite.query<{ title: string; track_id: string | null; status: string }>(
    "SELECT title, track_id, status FROM submissions WHERE id=$1",
    [id],
  );
  return rows.rows[0];
}

async function readAnswer(submissionId: string, fieldId: string) {
  const rows = await pglite.query<{ value: unknown }>(
    "SELECT value FROM submission_answers WHERE submission_id=$1 AND field_id=$2",
    [submissionId, fieldId],
  );
  return rows.rows[0]?.value;
}

beforeAll(async () => {
  pglite = new PGlite();
  await pglite.exec(migration0);
  await pglite.exec(migration1);
  testDb = createTestDb(pglite);

  await pglite.query(
    "INSERT INTO events(id,name,slug,starts_at,ends_at) VALUES($1,'Event','edit-until-close','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
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
    await pglite.query("INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES($1,$2,$3,'Test','Person')", [id, eventId, email]);
  }
  for (const [id, name] of [[trackA, "Track A"], [trackB, "Track B"]] as const) {
    await pglite.query("INSERT INTO tracks(id,event_id,name) VALUES($1,$2,$3)", [id, eventId, name]);
  }
  await pglite.query("INSERT INTO form_sections(id,event_id,form_id,key) VALUES($1,$2,$3,'main')", [mainSectionId, eventId, openForm]);
  await pglite.query("INSERT INTO form_sections(id,event_id,form_id,key) VALUES($1,$2,$3,'participant')", [participantSectionId, eventId, openForm]);
  for (const [id, sectionId, key, type] of [
    [titleField, mainSectionId, "title", "text"],
    [trackField, mainSectionId, "track", "dropdown"],
    [bioField, participantSectionId, "bio", "richtext"],
    [strayField, mainSectionId, "stray", "text"],
  ] as const) {
    await pglite.query(
      "INSERT INTO form_fields(id,event_id,form_id,section_id,key,label,field_type) VALUES($1,$2,$3,$4,$5,$5,$6)",
      [id, eventId, openForm, sectionId, key, type],
    );
  }
  await pglite.query("INSERT INTO form_versions(event_id,form_id,version,snapshot) VALUES($1,$2,1,$3)", [eventId, openForm, JSON.stringify(snapshot)]);
  // The closed form gets its own pinned version, since `form_id` is part of the
  // snapshot's compound identity in `form_versions`.
  await pglite.query(
    "INSERT INTO form_versions(event_id,form_id,version,snapshot) VALUES($1,$2,1,$3)",
    [eventId, closedForm, JSON.stringify({ ...snapshot, formId: closedForm })],
  );
}, 60_000);

afterAll(async () => {
  await pglite.close();
});

beforeEach(async () => {
  await pglite.query("DELETE FROM submissions");
});

describe("getEditableSubmission", () => {
  const submissionId = submissionIdSchema.parse("e2000000-0000-4000-8000-000000000001");

  it("returns the pinned snapshot and the submitter's abstract answers for a pending submission", async () => {
    await seedSubmission({ id: submissionId, status: "pending", code: 1, withCoSpeaker: true });

    const result = await getEditableSubmission(eventId, speaker, submissionId);

    expect("blocked" in result).toBe(false);
    if ("blocked" in result) return;
    expect(result.submission).toEqual({ submissionId, code: 1, title: "Original title" });
    expect(result.snapshot.version).toBe(1);
    expect(result.answers[titleField]).toEqual({ t: "s", v: "Original title" });
    expect(result.answers[trackField]).toEqual({ t: "opt", v: "opt-a" });
    // R10: a participant-scoped answer never surfaces in the flat abstract map —
    // that section is out of scope for this module's edit surface, not a stray
    // key the renderer has to tolerate.
    expect(result.answers[bioField]).toBeUndefined();
  });

  it("form-closed: is FORM_CLOSED against the database clock, not the page's", async () => {
    await seedSubmission({ id: submissionId, status: "pending", code: 1, formId: closedForm });
    const result = await getEditableSubmission(eventId, speaker, submissionId);
    expect(result).toEqual({ blocked: "FORM_CLOSED" });
  });

  it("not-editable-accepted: an accepted submission is NOT_EDITABLE, so the Edit CTA is never offered for it", async () => {
    await seedSubmission({ id: submissionId, status: "accepted", code: 1 });
    const result = await getEditableSubmission(eventId, speaker, submissionId);
    expect(result).toEqual({ blocked: "NOT_EDITABLE" });
  });

  it("is NOT_EDITABLE for a withdrawn submission", async () => {
    await seedSubmission({ id: submissionId, status: "withdrawn", code: 1 });
    const result = await getEditableSubmission(eventId, speaker, submissionId);
    expect(result).toEqual({ blocked: "NOT_EDITABLE" });
  });

  it("is editable for a draft submission", async () => {
    await seedSubmission({ id: submissionId, status: "draft", code: 1 });
    const result = await getEditableSubmission(eventId, speaker, submissionId);
    expect("blocked" in result).toBe(false);
  });

  it("co-speaker: is NOT_FOUND for a co-speaker on the submission — edit rights are submitter-only", async () => {
    await seedSubmission({ id: submissionId, status: "pending", code: 1, withCoSpeaker: true });
    const result = await getEditableSubmission(eventId, coSpeaker, submissionId);
    expect(result).toEqual({ blocked: "NOT_FOUND" });
  });

  it("is NOT_FOUND for a stranger, exactly like a submission that does not exist", async () => {
    await seedSubmission({ id: submissionId, status: "pending", code: 1 });
    const result = await getEditableSubmission(eventId, stranger, submissionId);
    expect(result).toEqual({ blocked: "NOT_FOUND" });
  });

  it("is NOT_FOUND for an id that does not exist", async () => {
    const result = await getEditableSubmission(eventId, speaker, "e2000000-0000-4000-8000-0000000000ff");
    expect(result).toEqual({ blocked: "NOT_FOUND" });
  });

  it("R10: a stray answer to a field this pinned version does not carry never crashes the render", async () => {
    await seedSubmission({ id: submissionId, status: "pending", code: 1 });
    // A field that exists on the form but was never part of this pinned
    // snapshot — the kind of row a hidden-by-visibility or since-orphaned
    // answer could leave behind.
    await pglite.query(
      "INSERT INTO submission_answers(event_id,submission_id,field_id,participant_id,value) VALUES($1,$2,$3,NULL,'{\"t\":\"s\",\"v\":\"orphan\"}'::jsonb)",
      [eventId, submissionId, strayField],
    );

    const result = await getEditableSubmission(eventId, speaker, submissionId);

    expect("blocked" in result).toBe(false);
    if ("blocked" in result) return;
    expect(result.answers[strayField]).toBeUndefined();
    expect(result.answers[titleField]).toEqual({ t: "s", v: "Original title" });
  });
});

describe("applySubmissionEdit", () => {
  const submissionId = submissionIdSchema.parse("e3000000-0000-4000-8000-000000000001");

  it("edit-updates-answers: editing a pending submission updates its answers and mapped columns, and preserves the co-speaker's untouched answers", async () => {
    await seedSubmission({ id: submissionId, status: "pending", code: 1, withCoSpeaker: true });

    const result = await applySubmissionEdit(eventId, speaker, submissionId, 1, {
      [titleField]: { t: "s", v: "An edited title" },
      [trackField]: { t: "opt", v: "opt-b" },
    });

    expect(result.rowVersion).toBeGreaterThan(1);
    const after = await readSubmission(submissionId);
    expect(after?.title).toBe("An edited title");
    // The dropdown maps straight to `submission.track_id` — a direct field
    // mapping, not a routing rule — so choosing a different real track does
    // update the stamp, same as `updateSubmissionFromCfp`'s own contract.
    expect(after?.track_id).toBe(trackB);
    expect(await readAnswer(submissionId, titleField)).toEqual({ t: "s", v: "An edited title" });
    // The co-speaker's bio was never part of this edit's payload, and must
    // survive it — `updateSubmissionFromCfp` replaces every answer for a field
    // on the pinned snapshot, so leaving participant answers out would delete
    // them.
    expect(await readAnswer(submissionId, bioField)).toEqual({ t: "s", v: "<p>Co-speaker bio</p>" });
  });

  it("routing-not-restamped: choosing the undecided option leaves the existing track_id alone rather than clearing it", async () => {
    await seedSubmission({ id: submissionId, status: "pending", code: 1 });
    expect((await readSubmission(submissionId))?.track_id).toBe(trackA);

    await applySubmissionEdit(eventId, speaker, submissionId, 1, {
      [titleField]: { t: "s", v: "Still a valid title" },
      [trackField]: { t: "opt", v: "opt-none" },
    });

    // "Undecided" means the option carries no track, not "clear the track an
    // organizer already routed this to" — and routing rules themselves are
    // simply never re-run on an edit (resolution #8).
    expect((await readSubmission(submissionId))?.track_id).toBe(trackA);
  });

  it("form-closed: refuses an edit after the form's close date with FORM_CLOSED, not a 500", async () => {
    await seedSubmission({ id: submissionId, status: "pending", code: 1, formId: closedForm });
    const error = await applySubmissionEdit(eventId, speaker, submissionId, 1, {
      [titleField]: { t: "s", v: "Too late" },
    }).catch((thrown: unknown) => thrown);
    expect(isAppError(error) && error.code).toBe("FORM_CLOSED");
    expect((await readSubmission(submissionId))?.title).toBe("Original title");
  });

  it("not-editable-accepted: refuses to edit a decided submission", async () => {
    await seedSubmission({ id: submissionId, status: "accepted", code: 1 });
    const error = await applySubmissionEdit(eventId, speaker, submissionId, 1, {
      [titleField]: { t: "s", v: "Too late" },
    }).catch((thrown: unknown) => thrown);
    expect(isAppError(error) && error.code).toBe("STALE_STATUS");
  });

  it("co-speaker: a forged edit from the co-speaker's own session is refused with NOT_FOUND", async () => {
    await seedSubmission({ id: submissionId, status: "pending", code: 1, withCoSpeaker: true });
    const error = await applySubmissionEdit(eventId, coSpeaker, submissionId, 1, {
      [titleField]: { t: "s", v: "Hijacked" },
    }).catch((thrown: unknown) => thrown);
    expect(isAppError(error) && error.code).toBe("NOT_FOUND");
    expect((await readSubmission(submissionId))?.title).toBe("Original title");
  });

  it("is NOT_FOUND for a stranger, and changes nothing", async () => {
    await seedSubmission({ id: submissionId, status: "pending", code: 1 });
    const error = await applySubmissionEdit(eventId, stranger, submissionId, 1, {
      [titleField]: { t: "s", v: "Hijacked" },
    }).catch((thrown: unknown) => thrown);
    expect(isAppError(error) && error.code).toBe("NOT_FOUND");
  });

  it("form-version-stale: refuses a save posted against a version other than the one pinned to this submission", async () => {
    await seedSubmission({ id: submissionId, status: "pending", code: 1 });
    const error = await applySubmissionEdit(eventId, speaker, submissionId, 2, {
      [titleField]: { t: "s", v: "Racing an update" },
    }).catch((thrown: unknown) => thrown);
    expect(isAppError(error) && error.code).toBe("FORM_VERSION_STALE");
    expect(isAppError(error) && (error.details as { version?: number })?.version).toBe(1);
  });

  it("rejects a missing required answer with field-scoped VALIDATION, and writes nothing", async () => {
    await seedSubmission({ id: submissionId, status: "pending", code: 1 });
    const error = await applySubmissionEdit(eventId, speaker, submissionId, 1, {
      [titleField]: { t: "s", v: "" },
    }).catch((thrown: unknown) => thrown);
    expect(isAppError(error) && error.code).toBe("VALIDATION");
    expect((await readSubmission(submissionId))?.title).toBe("Original title");
  });
});
