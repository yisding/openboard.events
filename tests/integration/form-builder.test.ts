import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbOrTx } from "@/db/client";
import * as schema from "@/db/schema";
import {
  createFieldIn,
  createFormIn,
  deleteFieldIn,
  duplicateFormIn,
  getFormForBuilderIn,
  listFormsIn,
  reorderFieldsIn,
  updateFieldIn,
  updateFormIn,
  updateFormWithPostCommitSignalsIn,
  updateSectionIn,
} from "@/features/forms";
import { eventIdSchema, formIdSchema, formSnapshotSchema } from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";

const migration0 = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");
// M50 is additive on top of the base schema; applying it keeps this fixture
// aligned with the columns the repository modules now read.
const migrationReviewOps = readFileSync(new URL("../../drizzle/0004_review_operations.sql", import.meta.url), "utf8");
const migrationTenancy = readFileSync(new URL("../../drizzle/0010_organization_tenancy.sql", import.meta.url), "utf8");
const migrationOnboardingMilestones = readFileSync(new URL("../../drizzle/0023_onboarding_milestones.sql", import.meta.url), "utf8");
const migrationParticipantReceipts = readFileSync(new URL("../../drizzle/0032_participant_step_receipts.sql", import.meta.url), "utf8");
const eventId = eventIdSchema.parse("ad000000-0000-4000-8000-000000000001");
const retryEventId = eventIdSchema.parse("ad000000-0000-4000-8000-000000000002");

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

describe("database-backed form builder", () => {
  let pglite: PGlite;
  let database: DbOrTx;

  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migration0);
    await pglite.exec(migration1);
    await pglite.exec(migrationReviewOps);
    await pglite.exec(migrationTenancy);
    await pglite.exec(migrationOnboardingMilestones);
    await pglite.exec(migrationParticipantReceipts);
    database = drizzle(pglite, { schema }) as unknown as DbOrTx;
    await pglite.query(
      "INSERT INTO events(id,name,slug,timezone,starts_at,ends_at) VALUES($1,'Builder Conf','builder-conf','America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
      [eventId],
    );
    await pglite.query(
      "INSERT INTO events(id,name,slug,timezone,starts_at,ends_at) VALUES($1,'Retry Builder Conf','retry-builder-conf','America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
      [retryEventId],
    );
    await pglite.query("INSERT INTO tracks(event_id,name,sort_order) VALUES($1,'AI Agents',0)", [eventId]);
    await pglite.query("INSERT INTO session_formats(event_id,name,sort_order) VALUES($1,'Workshop',0)", [eventId]);
    await pglite.query("INSERT INTO tags(event_id,name) VALUES($1,'Tooling')", [eventId]);
  }, 60_000);

  afterAll(async () => {
    await pglite.close();
  });

  it("creates two sections, twelve fields, four locked identities, and version one", async () => {
    const form = await createFormIn(database, eventId, { internalName: "Main CFP", kind: "abstract", collectParticipants: true });
    expect(form.sections).toHaveLength(2);
    expect(form.sections.flatMap((section) => section.fields)).toHaveLength(12);
    expect(form.sections.flatMap((section) => section.fields).filter((field) => field.locked).map((field) => field.key).sort())
      .toEqual(["email", "first_name", "last_name", "title"]);
    expect(form.currentVersion).toBe(1);
    expect(form.sections.flatMap((section) => section.fields).find((field) => field.key === "format")?.mapsTo).toBe("submission.format_id");

    const stored = await pglite.query<{ snapshot: unknown }>("SELECT snapshot FROM form_versions WHERE form_id=$1 AND version=1", [form.id]);
    expect(formSnapshotSchema.parse(stored.rows[0]?.snapshot).sections).toHaveLength(2);
    expect(await listFormsIn(database, eventId)).toMatchObject([{ id: form.id, submissionCount: 0, draftCount: 0, currentVersion: 1 }]);
  });

  it("records only the first transition to an open form", async () => {
    const created = await createFormIn(database, eventId, { internalName: "Milestone CFP", kind: "abstract", collectParticipants: true });
    const update = (status: "open" | "closed", expectedUpdatedAt: string) => updateFormWithPostCommitSignalsIn(
      database,
      (work) => database.transaction((tx) => work(tx as unknown as DbOrTx)),
      eventId,
      created.id,
      { status },
      expectedUpdatedAt,
      false,
    );
    try {
      const opened = await update("open", created.updatedAt);
      const closed = await update("closed", opened.updatedAt);
      await update("open", closed.updatedAt);

      const milestones = await pglite.query<{ milestone: string; n: number }>(
        "SELECT milestone, count(*)::int AS n FROM organization_onboarding_milestones WHERE milestone='form_published' GROUP BY milestone",
      );
      expect(milestones.rows).toEqual([{ milestone: "form_published", n: 1 }]);
    } finally {
      await pglite.query("DELETE FROM forms WHERE id=$1", [created.id]);
    }
  });

  it("replays a committed form create by stable client id without appending authoring rows", async () => {
    const stableFormId = formIdSchema.parse("ad000000-0000-4000-8000-000000000090");
    const input = { id: stableFormId, internalName: "Retry-safe CFP", kind: "abstract" as const, collectParticipants: true };

    const first = await createFormIn(database, retryEventId, input);
    const retry = await createFormIn(database, retryEventId, input);
    expect(retry.id).toBe(first.id);

    const forms = await pglite.query<{ n: number }>("SELECT count(*)::int AS n FROM forms WHERE id=$1", [stableFormId]);
    const sections = await pglite.query<{ n: number }>("SELECT count(*)::int AS n FROM form_sections WHERE form_id=$1", [stableFormId]);
    const fields = await pglite.query<{ n: number }>("SELECT count(*)::int AS n FROM form_fields WHERE form_id=$1", [stableFormId]);
    const versions = await pglite.query<{ n: number }>("SELECT count(*)::int AS n FROM form_versions WHERE form_id=$1", [stableFormId]);
    expect(forms.rows[0]?.n).toBe(1);
    expect(sections.rows[0]?.n).toBe(2);
    expect(fields.rows[0]?.n).toBe(12);
    expect(versions.rows[0]?.n).toBe(1);
  });

  it("repairs a partially committed stable form create, including a legacy section id", async () => {
    const stableFormId = formIdSchema.parse("ad000000-0000-4000-8000-000000000091");
    const legacyAbstractId = "ad000000-0000-4000-8000-000000000092";
    await pglite.query(
      `INSERT INTO forms(id,event_id,context,internal_name,external_title,status,kind,collect_participants,current_version)
       VALUES($1,$2,'cfp','Partially stored CFP','Partially stored CFP','draft','abstract',true,1)`,
      [stableFormId, retryEventId],
    );
    await pglite.query(
      "INSERT INTO form_sections(id,event_id,form_id,key,title,page_heading,sort_order) VALUES($1,$2,$3,'abstract','Stored abstract','Submission',0)",
      [legacyAbstractId, retryEventId, stableFormId],
    );
    await pglite.query(
      "INSERT INTO form_versions(event_id,form_id,version,snapshot) VALUES($1,$2,1,'{}'::jsonb)",
      [retryEventId, stableFormId],
    );

    const repaired = await createFormIn(database, retryEventId, {
      id: stableFormId, internalName: "Ignored retry copy", kind: "abstract", collectParticipants: true,
    });

    expect(repaired.internalName).toBe("Partially stored CFP");
    expect(repaired.sections).toHaveLength(2);
    expect(repaired.sections.flatMap((section) => section.fields)).toHaveLength(12);
    expect(repaired.sections.find((section) => section.key === "abstract")?.id).toBe(legacyAbstractId);
    const versions = await pglite.query<{ n: number; snapshot: unknown }>(
      "SELECT count(*) OVER()::int AS n, snapshot FROM form_versions WHERE form_id=$1",
      [stableFormId],
    );
    expect(versions.rows[0]?.n).toBe(1);
    expect(formSnapshotSchema.parse(versions.rows[0]?.snapshot).sections.flatMap((section) => section.fields)).toHaveLength(12);
  });

  it("converges overlapping stable form creates on one complete authoring graph", async () => {
    const stableFormId = formIdSchema.parse("ad000000-0000-4000-8000-000000000093");
    const input = { id: stableFormId, internalName: "Overlapping CFP", kind: "abstract" as const, collectParticipants: true };

    const [first, second] = await Promise.all([
      createFormIn(database, retryEventId, input),
      createFormIn(database, retryEventId, input),
    ]);

    expect(second.id).toBe(first.id);
    const counts = await pglite.query<{ sections: number; fields: number; versions: number }>(
      `SELECT
         (SELECT count(*)::int FROM form_sections WHERE form_id=$1) AS sections,
         (SELECT count(*)::int FROM form_fields WHERE form_id=$1) AS fields,
         (SELECT count(*)::int FROM form_versions WHERE form_id=$1) AS versions`,
      [stableFormId],
    );
    expect(counts.rows[0]).toEqual({ sections: 2, fields: 12, versions: 1 });
  });

  it("publishes one immutable version for every save and sanitizes organizer HTML", async () => {
    const form = required((await listFormsIn(database, eventId))[0], "created form");
    let builder = await getFormForBuilderIn(database, eventId, form.id);
    builder = await updateFormIn(database, eventId, form.id, { welcomeHtml: '<p>Hello</p><script>alert(1)</script>' }, builder.updatedAt);
    expect(builder.currentVersion).toBe(2);
    expect(builder.welcomeHtml).toBe("<p>Hello</p>");
    const section = required(builder.sections[0], "abstract section");
    builder = await updateSectionIn(database, eventId, form.id, section.id, { descriptionHtml: '<p>Instructions</p><img src=x onerror=alert(1)>' }, builder.updatedAt);
    expect(builder.currentVersion).toBe(3);
    expect(builder.sections[0]?.descriptionHtml).toBe("<p>Instructions</p>");

    const versions = await pglite.query<{ version: number }>("SELECT version FROM form_versions WHERE form_id=$1 ORDER BY version", [form.id]);
    expect(versions.rows.map((row) => row.version)).toEqual([1, 2, 3]);
  });

  it("returns raw publishing status plus draft, scheduled, live, ended, and closed availability", async () => {
    const formId = required((await listFormsIn(database, eventId))[0], "created form").id;
    const now = new Date("2026-08-12T18:00:00.000Z");

    await pglite.query("UPDATE forms SET status='draft', opens_at=NULL, closes_at=NULL WHERE id=$1", [formId]);
    expect(await listFormsIn(database, eventId, "cfp", now)).toMatchObject([{ id: formId, status: "draft", availability: "draft" }]);

    await pglite.query("UPDATE forms SET status='open', opens_at='2026-08-13T18:00:00Z', closes_at=NULL WHERE id=$1", [formId]);
    expect(await listFormsIn(database, eventId, "cfp", now)).toMatchObject([{
      id: formId,
      status: "open",
      availability: "scheduled",
      opensAt: "2026-08-13T18:00:00.000Z",
    }]);

    await pglite.query("UPDATE forms SET opens_at='2026-08-12T18:00:00Z', closes_at='2026-08-12T18:00:00.001Z' WHERE id=$1", [formId]);
    expect(await listFormsIn(database, eventId, "cfp", now)).toMatchObject([{ id: formId, status: "open", availability: "live" }]);

    await pglite.query("UPDATE forms SET closes_at='2026-08-12T18:00:00Z' WHERE id=$1", [formId]);
    expect(await listFormsIn(database, eventId, "cfp", now)).toMatchObject([{
      id: formId,
      status: "open",
      availability: "ended",
      closesAt: "2026-08-12T18:00:00.000Z",
    }]);

    await pglite.query("UPDATE forms SET status='closed', opens_at=NULL, closes_at=NULL WHERE id=$1", [formId]);
    expect(await listFormsIn(database, eventId, "cfp", now)).toMatchObject([{ id: formId, status: "closed", availability: "closed" }]);

    await pglite.query("UPDATE forms SET status='draft' WHERE id=$1", [formId]);
  });

  it("supports all eight committed types and preserves option ids while labels change", async () => {
    const formId = required((await listFormsIn(database, eventId))[0], "created form").id;
    let form = await getFormForBuilderIn(database, eventId, formId);
    const section = required(form.sections[0], "abstract section");
    for (const [label, fieldType] of [["Long answer", "textarea"], ["Website", "url"], ["Slides", "file"]] as const) {
      form = await createFieldIn(database, eventId, formId, { sectionId: section.id, label, fieldType }, form.updatedAt);
    }
    const optionField = required(required(form.sections[0], "abstract section").fields.find((field) => field.key === "level"), "option field");
    const optionIds = optionField.options.map((option) => option.id);
    form = await updateFieldIn(database, eventId, formId, optionField.id, { optionLabels: optionField.options.map((option) => `${option.label} updated`) }, form.updatedAt);
    expect(form.sections.flatMap((candidate) => candidate.fields).find((field) => field.id === optionField.id)?.options.map((option) => option.id)).toEqual(optionIds);
    const types = new Set(form.sections.flatMap((candidate) => candidate.fields).map((field) => field.fieldType));
    expect([...types].sort()).toEqual(["dropdown", "email", "file", "multiselect", "richtext", "text", "textarea", "url"]);
  });

  it("binds mapped dropdown options to event vocabulary and rejects unknown labels", async () => {
    const formId = required((await listFormsIn(database, eventId))[0], "created form").id;
    let form = await getFormForBuilderIn(database, eventId, formId);
    const track = required(form.sections.flatMap((section) => section.fields).find((field) => field.key === "track"), "track field");
    const invalid = await updateFieldIn(database, eventId, formId, track.id, { optionLabels: ["Not an event track"] }, form.updatedAt)
      .catch((error: unknown) => error);
    expect(isAppError(invalid) && invalid.code).toBe("VALIDATION");

    const inserted = await pglite.query<{ id: string }>(
      "INSERT INTO tracks(event_id,name,sort_order) VALUES($1,'Platform Engineering',1) RETURNING id",
      [eventId],
    );
    form = await updateFieldIn(database, eventId, formId, track.id, { optionLabels: ["AI Agents", "Platform Engineering"] }, form.updatedAt);
    const saved = required(form.sections.flatMap((section) => section.fields).find((field) => field.id === track.id), "saved track field");
    expect(saved.options[1]).toMatchObject({ label: "Platform Engineering", trackId: inserted.rows[0]?.id });
  });

  it("rejects locked-field weakening and stale writes without publishing a version", async () => {
    const formId = required((await listFormsIn(database, eventId))[0], "created form").id;
    const form = await getFormForBuilderIn(database, eventId, formId);
    const title = required(form.sections.flatMap((section) => section.fields).find((field) => field.key === "title"), "title field");
    const before = form.currentVersion;
    const locked = await updateFieldIn(database, eventId, formId, title.id, { required: false }, form.updatedAt).catch((error: unknown) => error);
    expect(isAppError(locked) && locked.code).toBe("VALIDATION");
    expect((await getFormForBuilderIn(database, eventId, formId)).currentVersion).toBe(before);

    const first = await updateFormIn(database, eventId, formId, { externalTitle: "Fresh" }, form.updatedAt);
    const stale = await updateFormIn(database, eventId, formId, { externalTitle: "Stale" }, form.updatedAt).catch((error: unknown) => error);
    expect(isAppError(stale) && stale.code).toBe("STALE_WRITE");
    expect(first.externalTitle).toBe("Fresh");
  });

  it("locks structural changes after a submission but still allows copy and gap-free reorder", async () => {
    const formId = required((await listFormsIn(database, eventId))[0], "created form").id;
    let form = await getFormForBuilderIn(database, eventId, formId);
    await pglite.query("INSERT INTO submissions(event_id,form_id,form_version,code,status,title) VALUES($1,$2,$3,1,'pending','Submitted')", [eventId, formId, form.currentVersion]);
    await pglite.query("INSERT INTO submissions(event_id,form_id,form_version,code,status,title) VALUES($1,$2,$3,2,'draft','Draft')", [eventId, formId, form.currentVersion]);
    expect(await listFormsIn(database, eventId)).toMatchObject([{ id: formId, submissionCount: 1, draftCount: 1, pendingCount: 1 }]);
    form = await getFormForBuilderIn(database, eventId, formId);
    expect(form.hasNonDraftSubmissions).toBe(true);
    const section = required(form.sections[0], "abstract section");
    const title = required(section.fields.find((field) => field.key === "title"), "title field");
    const structural = await deleteFieldIn(database, eventId, formId, title.id, form.updatedAt).catch((error: unknown) => error);
    expect(isAppError(structural) && structural.code).toBe("VALIDATION");
    const add = await createFieldIn(database, eventId, formId, { sectionId: section.id, label: "Too late", fieldType: "text" }, form.updatedAt).catch((error: unknown) => error);
    expect(isAppError(add) && add.code).toBe("FORM_LOCKED");

    form = await updateFieldIn(database, eventId, formId, title.id, { label: "Updated title copy" }, form.updatedAt);
    const reorderedSection = required(form.sections[0], "abstract section");
    const reversed = [...reorderedSection.fields].reverse().map((field) => field.id);
    form = await reorderFieldsIn(database, eventId, formId, reorderedSection.id, reversed, form.updatedAt);
    const savedSection = required(form.sections[0], "saved abstract section");
    expect(savedSection.fields.map((field) => field.sortOrder)).toEqual(savedSection.fields.map((_, index) => index));
  });

  // M12-GENERALIZE: `context` is a parameter now (still defaulting to "cfp"
  // for every caller above), and portal forms carry `targetType`. This is
  // what unblocks M24 reusing the same createFormIn/getFormForBuilderIn/
  // saveFormStep engine for context='portal' forms (plan/modules/M24).
  describe("context='portal' forms (M24's engine reuse)", () => {
    it("rejects a portal form with no targetType", async () => {
      const rejected = await createFormIn(database, eventId, {
        internalName: "Missing target type",
        kind: "abstract",
        collectParticipants: false,
        context: "portal",
      }).catch((error: unknown) => error);
      expect(isAppError(rejected) && rejected.code).toBe("VALIDATION");
    });

    it("creates a minimal skeleton — one section, zero fields, no CFP locked identities", async () => {
      const form = await createFormIn(database, eventId, {
        internalName: "Update Your Information",
        kind: "abstract",
        collectParticipants: false,
        context: "portal",
        targetType: "contact",
      });
      expect(form.context).toBe("portal");
      expect(form.targetType).toBe("contact");
      expect(form.sections).toHaveLength(1);
      expect(form.sections.flatMap((section) => section.fields)).toHaveLength(0);
      expect(form.currentVersion).toBe(1);
    });

    it("lists separately from cfp forms, is readable by id without a context filter, and saves through the same path", async () => {
      const created = await createFormIn(database, eventId, {
        internalName: "Session Info",
        kind: "abstract",
        collectParticipants: false,
        context: "portal",
        targetType: "submission",
      });

      // listForms still defaults to "cfp" for every pre-existing caller — the
      // portal form must not leak into that list, and vice versa.
      const cfpList = await listFormsIn(database, eventId);
      expect(cfpList.some((row) => row.id === created.id)).toBe(false);
      // Not the *only* row: the previous case in this describe block already
      // created "Update Your Information" (context='portal', contact) against
      // this same shared pglite instance — this list must contain this run's
      // form alongside it, not replace it.
      const portalList = await listFormsIn(database, eventId, "portal");
      expect(portalList).toContainEqual(expect.objectContaining({ id: created.id, targetType: "submission" }));

      // A form id + eventId is already a unique key — getFormForBuilderIn
      // must not additionally reject it for not being "cfp" (that was the
      // exact bug M24's blocker described).
      const read = await getFormForBuilderIn(database, eventId, created.id);
      expect(read.context).toBe("portal");

      // A caller that pins a context still gets the right rejection.
      const mismatched = await getFormForBuilderIn(database, eventId, created.id, "cfp").catch((error: unknown) => error);
      expect(isAppError(mismatched) && mismatched.code).toBe("NOT_FOUND");

      // The same saveFormStep-backing mutation (updateFormIn) works against
      // a portal form and pins a new snapshot version, unchanged.
      const saved = await updateFormIn(database, eventId, created.id, { internalName: "Session Info (renamed)" }, read.updatedAt);
      expect(saved.internalName).toBe("Session Info (renamed)");
      expect(saved.currentVersion).toBe(2);

      // And the field-CRUD engine (M24's "reuse the field CRUD components
      // verbatim") works against it too — a contact-mapped custom field, no
      // CFP locked-identity requirements apply (compileFormSnapshot skips
      // that check for context !== 'cfp').
      const withField = await createFieldIn(database, eventId, created.id, {
        sectionId: required(saved.sections[0], "questions section").id,
        label: "Bio",
        fieldType: "richtext",
      }, saved.updatedAt);
      expect(withField.sections.flatMap((section) => section.fields)).toHaveLength(1);
      expect(withField.currentVersion).toBe(3);
    });
  });

  it("carries the per-speaker submission limit into a duplicate", async () => {
    const source = await createFormIn(database, eventId, { internalName: "Capped CFP", kind: "abstract", collectParticipants: false });
    const capped = await updateFormIn(database, eventId, source.id, { submissionLimit: 1 }, source.updatedAt);
    expect(capped.submissionLimit).toBe(1);

    // The copy dropped it, and `public-form.ts` then falls back to the
    // event-wide `submissionCapPerUser` — so a form limited to one proposal
    // per speaker duplicated into one accepting the event default. It is a
    // setting, not part of the submissions/analytics trail the copy is
    // documented as leaving behind.
    const copy = await duplicateFormIn(database, eventId, source.id);
    expect(copy.submissionLimit).toBe(1);
  });

  it("keeps a track-mapped question editable after its track is renamed", async () => {
    const source = await createFormIn(database, eventId, { internalName: "Mapped CFP", kind: "abstract", collectParticipants: false });
    // The seeded CFP already carries the one track-mapped question a form is
    // allowed (`assertUniqueMapsTo`), which is the field this is about.
    let form = source;
    const trackField = required(
      form.sections.flatMap((s) => s.fields).find((field) => field.mapsTo === "submission.track_id"),
      "track field",
    );
    expect(trackField.options.map((option) => option.label)).toContain("AI Agents");

    await pglite.query("UPDATE tracks SET name='AI & ML' WHERE event_id=$1 AND name='AI Agents'", [eventId]);

    // Nothing propagates a rename into `form_fields.options[].label`, and
    // `updateFieldIn` re-runs the mapped-option reconcile on *every* patch to
    // this field — with the stale stored labels, since the patch does not
    // touch options. Resolving by label alone made this throw
    // `"AI Agents" is not an event track`, permanently: the question could
    // never be saved again until every label was retyped by hand.
    form = await updateFieldIn(database, eventId, source.id, trackField.id, { helpText: "Pick one" }, form.updatedAt);

    const healed = required(form.sections.flatMap((s) => s.fields).find((field) => field.id === trackField.id), "track field");
    expect(healed.helpText).toBe("Pick one");
    // The stored label follows the rename rather than staying stale.
    expect(healed.options.map((option) => option.label)).toContain("AI & ML");
    expect(healed.options.map((option) => option.label)).not.toContain("AI Agents");

    await pglite.query("UPDATE tracks SET name='AI Agents' WHERE event_id=$1 AND name='AI & ML'", [eventId]);
  });

  it("re-points a duplicated form's conditional rules at the copy's own fields", async () => {
    const source = await createFormIn(database, eventId, { internalName: "Conditional CFP", kind: "abstract", collectParticipants: false });
    const section = required(source.sections[0], "abstract section");
    let form = await createFieldIn(
      database, eventId, source.id,
      { sectionId: section.id, label: "Delivery style", fieldType: "dropdown" },
      source.updatedAt,
    );
    const format = required(form.sections.flatMap((s) => s.fields).find((field) => field.label === "Delivery style"), "format field");
    form = await updateFieldIn(database, eventId, source.id, format.id, { optionLabels: ["Talk", "Workshop"] }, form.updatedAt);
    const workshop = required(
      required(form.sections.flatMap((s) => s.fields).find((field) => field.id === format.id), "format field").options[1],
      "workshop option",
    );
    form = await createFieldIn(
      database, eventId, source.id,
      { sectionId: section.id, label: "Workshop duration", fieldType: "text" },
      form.updatedAt,
    );
    const duration = required(form.sections.flatMap((s) => s.fields).find((field) => field.label === "Workshop duration"), "duration field");
    form = await updateFieldIn(
      database, eventId, source.id, duration.id,
      { visibility: { match: "all", conditions: [{ sourceFieldId: format.id, op: "eq", value: workshop.id }] } },
      form.updatedAt,
    );

    // Duplication is the escape hatch the product itself points organizers at
    // once a form has submissions ("Duplicate it to change its structure"), so
    // it has to survive the feature that most needs it.
    const copy = await duplicateFormIn(database, eventId, source.id);

    const copiedFields = copy.sections.flatMap((s) => s.fields);
    const copiedFormat = required(copiedFields.find((field) => field.label === "Delivery style"), "copied format field");
    const copiedDuration = required(copiedFields.find((field) => field.label === "Workshop duration"), "copied duration field");
    expect(copiedFormat.id).not.toBe(format.id);
    // The rule must name the copy's own field, not the source form's.
    expect(copiedDuration.visibility?.conditions[0]?.sourceFieldId).toBe(copiedFormat.id);
    expect(copiedDuration.visibility?.conditions[0]?.sourceFieldId).not.toBe(format.id);

    // And the copy must be usable: the snapshot compiles and resolves the rule.
    const stored = await pglite.query<{ snapshot: unknown }>(
      "SELECT snapshot FROM form_versions WHERE form_id=$1 AND version=1", [copy.id],
    );
    const snapshot = formSnapshotSchema.parse(stored.rows[0]?.snapshot);
    const snapshotDuration = required(
      snapshot.sections.flatMap((s) => s.fields).find((field) => field.label === "Workshop duration"),
      "snapshot duration field",
    );
    expect(snapshotDuration.visibility?.conditions[0]?.sourceFieldId).toBe(copiedDuration.visibility?.conditions[0]?.sourceFieldId);
  });

  it("keeps the portal link in a saved confirmation email body", async () => {
    // The stored body is what is re-rendered at send time. `sanitize()` drops
    // any href that is not http(s)/mailto — which is every merge token — so a
    // confirmation edited in the builder reached speakers with a dead "Open
    // your speaker portal", exactly the link the shipped default is built on.
    const formId = required((await listFormsIn(database, eventId))[0], "created form").id;
    const form = await getFormForBuilderIn(database, eventId, formId);
    const saved = await updateFormIn(database, eventId, formId, {
      confirmationBodyHtml: '<p>Thanks! <a href="{{portal.magic_link}}">Open your speaker portal</a></p>',
    }, form.updatedAt);

    expect(saved.confirmationBodyHtml).toContain('href="{{portal.magic_link}}"');
  });

  it("gives a field added after a delete a position of its own", async () => {
    const source = await createFormIn(database, eventId, { internalName: "Sort order CFP", kind: "abstract", collectParticipants: false });
    const section = required(source.sections[0], "abstract section");
    let form = source;
    for (const label of ["First", "Second", "Third"]) {
      form = await createFieldIn(database, eventId, source.id, { sectionId: section.id, label, fieldType: "text" }, form.updatedAt);
    }
    const fields = () => form.sections.flatMap((candidate) => candidate.fields).filter((field) => field.sectionId === section.id);
    const second = required(fields().find((field) => field.label === "Second"), "second field");

    // Soft delete leaves the row and its sort_order behind, so deriving the new
    // position from the *count* of live fields reuses one that is still taken.
    form = await deleteFieldIn(database, eventId, source.id, second.id, form.updatedAt);
    form = await createFieldIn(database, eventId, source.id, { sectionId: section.id, label: "Fourth", fieldType: "text" }, form.updatedAt);

    const orders = fields().map((field) => field.sortOrder);
    expect(new Set(orders).size).toBe(orders.length);
    const fourth = required(fields().find((field) => field.label === "Fourth"), "fourth field");
    const third = required(fields().find((field) => field.label === "Third"), "third field");
    expect(fourth.sortOrder).toBeGreaterThan(third.sortOrder);
  });
});
