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
  getFormForBuilderIn,
  listFormsIn,
  reorderFieldsIn,
  updateFieldIn,
  updateFormIn,
  updateSectionIn,
} from "@/features/forms";
import { eventIdSchema, formSnapshotSchema } from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";

const migration0 = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");
// M50 is additive on top of the base schema; applying it keeps this fixture
// aligned with the columns the repository modules now read.
const migrationReviewOps = readFileSync(new URL("../../drizzle/0004_review_operations.sql", import.meta.url), "utf8");
const eventId = eventIdSchema.parse("ad000000-0000-4000-8000-000000000001");

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
    database = drizzle(pglite, { schema }) as unknown as DbOrTx;
    await pglite.query(
      "INSERT INTO events(id,name,slug,timezone,starts_at,ends_at) VALUES($1,'Builder Conf','builder-conf','America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
      [eventId],
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

  it("reports date-gated open forms as effectively closed", async () => {
    const formId = required((await listFormsIn(database, eventId))[0], "created form").id;
    await pglite.query("UPDATE forms SET status='open', closes_at=now() - interval '1 minute' WHERE id=$1", [formId]);
    expect(await listFormsIn(database, eventId)).toMatchObject([{ id: formId, status: "closed" }]);
    await pglite.query("UPDATE forms SET status='draft', closes_at=NULL WHERE id=$1", [formId]);
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
});
