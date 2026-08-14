import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbOrTx } from "@/db/client";
import * as schema from "@/db/schema";
import {
  createFieldIn,
  createFormIn,
  deleteFormIn,
  duplicateFormIn,
  getFormForBuilderIn,
  updateFieldIn,
  updateFormIn,
} from "@/features/forms";
import { STANDARD_FIELD_LIBRARY, standardFieldsFor } from "@/features/portal/form-builder/components/field-library";
import { eventIdSchema, formSnapshotSchema, mapsToTargetSchema } from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";

/**
 * M24 — the portal form builder's own PGlite acceptance coverage. M12's
 * generalization of `createFormIn`/`getFormForBuilderIn`/field-CRUD to
 * `context='portal'` forms is exercised in `tests/integration/form-builder.
 * test.ts`'s own "context='portal' forms" block — this file only covers
 * what is genuinely M24's: the standard-field library (§5), duplicate/delete
 * (§7, both new here — no prior module exposed either), and the concurrent-
 * edit guard restated for a portal form specifically (§8).
 */
const migration0 = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");
const migrationReviewOps = readFileSync(new URL("../../drizzle/0004_review_operations.sql", import.meta.url), "utf8");
const migrationParticipantReceipts = readFileSync(new URL("../../drizzle/0032_participant_step_receipts.sql", import.meta.url), "utf8");
const eventId = eventIdSchema.parse("f2000000-0000-4000-8000-000000000001");

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

describe("M24 portal form builder", () => {
  let pglite: PGlite;
  let database: DbOrTx;

  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migration0);
    await pglite.exec(migration1);
    await pglite.exec(migrationReviewOps);
    await pglite.exec(migrationParticipantReceipts);
    database = drizzle(pglite, { schema }) as unknown as DbOrTx;
    await pglite.query(
      "INSERT INTO events(id,name,slug,timezone,starts_at,ends_at) VALUES($1,'Portal Conf','portal-conf','America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
      [eventId],
    );
  }, 60_000);

  afterAll(async () => {
    await pglite.close();
  });

  it("standard-field library: every entry's maps_to is in the closed allowlist, and target types never mix", () => {
    for (const item of STANDARD_FIELD_LIBRARY) {
      expect(mapsToTargetSchema.safeParse(item.mapsTo).success).toBe(true);
    }
    expect(standardFieldsFor("contact").every((item) => item.mapsTo.startsWith("contact."))).toBe(true);
    expect(standardFieldsFor("submission").every((item) => item.mapsTo.startsWith("submission."))).toBe(true);
    // A contact-target form never offers a submission field and vice versa —
    // the exact filter the "Add field" popover applies (M24 §5 Done-when).
    expect(standardFieldsFor("contact")).toHaveLength(5);
    expect(standardFieldsFor("submission")).toHaveLength(3);
  });

  it("rejects a maps_to string outside the closed allowlist (the validation M24 must not bypass)", () => {
    expect(mapsToTargetSchema.safeParse("contact.ssn").success).toBe(false);
    expect(mapsToTargetSchema.safeParse("submission.budget_usd").success).toBe(false);
    expect(mapsToTargetSchema.safeParse("").success).toBe(false);
  });

  it("adds every contact-target library field atomically with its canonical mapping", async () => {
    const form = await createFormIn(database, eventId, {
      internalName: "Update Your Information",
      kind: "abstract",
      collectParticipants: false,
      context: "portal",
      targetType: "contact",
    });
    const section = required(form.sections[0], "questions section");
    let current = form;
    for (const item of standardFieldsFor("contact")) {
      current = await createFieldIn(database, eventId, form.id, {
        sectionId: section.id,
        label: item.label,
        fieldType: item.fieldType,
        mapsTo: item.mapsTo,
      }, current.updatedAt);
    }
    const fields = current.sections.flatMap((s) => s.fields);
    expect(fields).toHaveLength(5);
    expect(fields.every((field) => field.visibility === null)).toBe(true);
    expect(fields.map((field) => field.mapsTo).sort()).toEqual([...standardFieldsFor("contact").map((item) => item.mapsTo)].sort());

    const bio = required(fields.find((field) => field.mapsTo === "contact.bio_html"), "bio field");
    expect(bio.fieldType).toBe("richtext");
    const headshot = required(fields.find((field) => field.mapsTo === "contact.headshot_file_id"), "headshot field");
    expect(headshot.fieldType).toBe("file");

    const beforeDuplicate = current.sections.flatMap((candidate) => candidate.fields).length;
    await expect(createFieldIn(database, eventId, form.id, {
      sectionId: section.id,
      label: "Bio again",
      fieldType: "richtext",
      mapsTo: "contact.bio_html",
    }, current.updatedAt)).rejects.toMatchObject({ code: "VALIDATION" });
    const afterDuplicate = await getFormForBuilderIn(database, eventId, form.id);
    expect(afterDuplicate.sections.flatMap((candidate) => candidate.fields)).toHaveLength(beforeDuplicate);
  });

  it("rejects setting a maps_to whose target doesn't match the form's own target_type (review finding: mis-mapped write-back)", async () => {
    const form = await createFormIn(database, eventId, {
      internalName: "Session Info (mismatch guard)",
      kind: "abstract",
      collectParticipants: false,
      context: "portal",
      targetType: "submission",
    });
    const section = required(form.sections[0], "questions section");
    const created = await createFieldIn(database, eventId, form.id, { sectionId: section.id, label: "Email", fieldType: "email" }, form.updatedAt);
    const field = required(created.sections.flatMap((s) => s.fields).find((f) => f.label === "Email"), "created email field");

    // A submission-target portal form must never accept a contact.* mapping —
    // that would make deriveMappedFields' unconditional contact write-back
    // (features/portal/task-runtime/server/mutations.ts) silently overwrite a
    // responding contact's real profile data on task completion.
    const rejected = await updateFieldIn(database, eventId, form.id, field.id, { mapsTo: "contact.email" }, created.updatedAt).catch((error: unknown) => error);
    expect(isAppError(rejected) && rejected.code).toBe("VALIDATION");

    // The field itself, and the form, are unchanged by the rejected attempt.
    const reread = await getFormForBuilderIn(database, eventId, form.id);
    const rereadField = required(reread.sections.flatMap((s) => s.fields).find((f) => f.id === field.id), "reread email field");
    expect(rereadField.mapsTo).toBeNull();
  });

  it("adds the Session Level dropdown with admin-authored free-text options, unbound to track/format/tag", async () => {
    const form = await createFormIn(database, eventId, {
      internalName: "Session Info",
      kind: "abstract",
      collectParticipants: false,
      context: "portal",
      targetType: "submission",
    });
    const section = required(form.sections[0], "questions section");
    const levelItem = required(standardFieldsFor("submission").find((item) => item.mapsTo === "submission.level"), "level library item");
    const current = await createFieldIn(database, eventId, form.id, {
      sectionId: section.id,
      label: levelItem.label,
      fieldType: levelItem.fieldType,
      mapsTo: levelItem.mapsTo,
      optionLabels: [...required(levelItem.defaultOptionLabels, "level default options")],
    }, form.updatedAt);
    const level = required(current.sections.flatMap((s) => s.fields).find((field) => field.mapsTo === levelItem.mapsTo), "saved level field");
    expect(level.options.map((option) => option.label)).toEqual(["Beginner", "Intermediate", "Advanced"]);
    expect(level.options.every((option) => !option.trackId && !option.formatId && !option.tagId)).toBe(true);
  });

  it("compiles a zod-valid FormSnapshot on every save, through the same compiler CFP forms use", async () => {
    const form = await createFormIn(database, eventId, {
      internalName: "Snapshot Check",
      kind: "abstract",
      collectParticipants: false,
      context: "portal",
      targetType: "contact",
    });
    const stored = await pglite.query<{ snapshot: unknown }>("SELECT snapshot FROM form_versions WHERE form_id=$1 AND version=1", [form.id]);
    const parsed = formSnapshotSchema.parse(stored.rows[0]?.snapshot);
    expect(parsed.context).toBe("portal");
    expect(parsed.sections).toHaveLength(1);
  });

  describe("duplicate (M24 §7 — settings-and-structure-only copy)", () => {
    it("produces an independent draft with a new id, fresh version 1, and the same fields", async () => {
      const source = await createFormIn(database, eventId, {
        internalName: "Source Form",
        kind: "abstract",
        collectParticipants: false,
        context: "portal",
        targetType: "contact",
      });
      const section = required(source.sections[0], "questions section");
      const withField = await createFieldIn(database, eventId, source.id, { sectionId: section.id, label: "Bio", fieldType: "richtext" }, source.updatedAt);
      const bioField = required(withField.sections.flatMap((s) => s.fields).find((field) => field.label === "Bio"), "bio field");
      const withMapping = await updateFieldIn(database, eventId, source.id, bioField.id, { mapsTo: "contact.bio_html" }, withField.updatedAt);

      const copy = await duplicateFormIn(database, eventId, source.id);
      expect(copy.id).not.toBe(source.id);
      expect(copy.status).toBe("draft");
      expect(copy.currentVersion).toBe(1);
      expect(copy.context).toBe("portal");
      expect(copy.targetType).toBe("contact");
      expect(copy.internalName).toBe("Source Form (Copy)");

      const copySection = required(copy.sections[0], "copied section");
      expect(copySection.id).not.toBe(section.id);
      const copyFields = copySection.fields.map((field) => ({ label: field.label, fieldType: field.fieldType, mapsTo: field.mapsTo }));
      expect(copyFields).toEqual([{ label: "Bio", fieldType: "richtext", mapsTo: "contact.bio_html" }]);
      expect(copySection.fields[0]?.id).not.toBe(bioField.id);

      // Editing the copy never touches the source — independent rows, not a view.
      await updateFieldIn(database, eventId, copy.id, required(copySection.fields[0], "copy bio field").id, { label: "Bio (edited)" }, copy.updatedAt);
      const sourceUnchanged = await getFormForBuilderIn(database, eventId, source.id);
      expect(required(sourceUnchanged.sections[0], "source section").fields[0]?.label).toBe("Bio");
      void withMapping;
    });
  });

  describe("delete (M24 §7 — RESTRICT-guarded, same copy M23 shows for a referenced file request)", () => {
    it("blocks deletion while a task references the form, then succeeds once it doesn't", async () => {
      const form = await createFormIn(database, eventId, {
        internalName: "Referenced Form",
        kind: "abstract",
        collectParticipants: false,
        context: "portal",
        targetType: "contact",
      });
      const task = await pglite.query<{ id: string }>(
        "INSERT INTO portal_tasks(event_id,name,target_type,completion_mode,form_id) VALUES($1,'Update profile','contact','form',$2) RETURNING id",
        [eventId, form.id],
      );
      const taskId = required(task.rows[0]?.id, "inserted task id");

      const blocked = await deleteFormIn(database, eventId, form.id).catch((error: unknown) => error);
      expect(isAppError(blocked) && blocked.code).toBe("CONFLICT");
      expect(isAppError(blocked) && blocked.message).toBe("This form/file request is used by a task. Revert the task to Manual first.");

      // Confirm the form is still there — a rejected precheck must never
      // have partially deleted anything.
      const stillThere = await pglite.query("SELECT id FROM forms WHERE id=$1", [form.id]);
      expect(stillThere.rows).toHaveLength(1);

      await pglite.query("UPDATE portal_tasks SET form_id=NULL, completion_mode='manual' WHERE id=$1", [taskId]);
      await deleteFormIn(database, eventId, form.id);
      const gone = await pglite.query("SELECT id FROM forms WHERE id=$1", [form.id]);
      expect(gone.rows).toHaveLength(0);
    });

    it("404s deleting a form id from a different event, and a form that no longer exists", async () => {
      const otherEventId = eventIdSchema.parse("f2000000-0000-4000-8000-000000000099");
      await pglite.query(
        "INSERT INTO events(id,name,slug,timezone,starts_at,ends_at) VALUES($1,'Other Conf','other-conf','America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
        [otherEventId],
      );
      const form = await createFormIn(database, eventId, {
        internalName: "Cross-event guard",
        kind: "abstract",
        collectParticipants: false,
        context: "portal",
        targetType: "contact",
      });
      const wrongEvent = await deleteFormIn(database, otherEventId, form.id).catch((error: unknown) => error);
      expect(isAppError(wrongEvent) && wrongEvent.code).toBe("NOT_FOUND");
      await deleteFormIn(database, eventId, form.id);
      const missing = await deleteFormIn(database, eventId, form.id).catch((error: unknown) => error);
      expect(isAppError(missing) && missing.code).toBe("NOT_FOUND");
    });

    /**
     * `form_responses.form_id` -> `forms.id` is ON DELETE CASCADE, unlike the
     * RESTRICT `portal_tasks` FK above — nothing at the database layer would
     * stop a delete from silently wiping every collected response once the
     * task reference is gone (task deleted, or reverted to Manual). This is
     * the review finding this precheck closes.
     */
    it("blocks deletion once the form has collected responses, even with no task referencing it", async () => {
      const form = await createFormIn(database, eventId, {
        internalName: "Responded Form",
        kind: "abstract",
        collectParticipants: false,
        context: "portal",
        targetType: "contact",
      });
      const contact = await pglite.query<{ id: string }>(
        "INSERT INTO contacts(event_id,email,first_name,last_name) VALUES($1,'responder@example.com','R','Ex') RETURNING id",
        [eventId],
      );
      const contactId = required(contact.rows[0]?.id, "inserted contact id");
      await pglite.query(
        "INSERT INTO form_responses(event_id,form_id,form_version,contact_id,answers) VALUES($1,$2,1,$3,'{}')",
        [eventId, form.id, contactId],
      );

      const blocked = await deleteFormIn(database, eventId, form.id).catch((error: unknown) => error);
      expect(isAppError(blocked) && blocked.code).toBe("CONFLICT");
      const stillThere = await pglite.query("SELECT id FROM forms WHERE id=$1", [form.id]);
      expect(stillThere.rows).toHaveLength(1);
    });

    /**
     * `deleteFormIn` is generic across context and reachable for a `cfp`
     * form via `DELETE /api/internal/forms/[formId]` just like a portal one
     * — it needs the same hasNonDraftSubmissions guard `updateFormIn`'s
     * structural-edit check already applies, or a CFP form with live
     * submissions could be deleted out from under them.
     */
    it("blocks deletion of a CFP form with non-draft submissions", async () => {
      const form = await createFormIn(database, eventId, {
        internalName: "CFP form with submissions",
        kind: "abstract",
        collectParticipants: false,
      });
      const contact = await pglite.query<{ id: string }>(
        "INSERT INTO contacts(event_id,email,first_name,last_name) VALUES($1,'cfp-submitter@example.com','C','Fp') RETURNING id",
        [eventId],
      );
      const contactId = required(contact.rows[0]?.id, "inserted contact id");
      await pglite.query(
        `INSERT INTO submissions(event_id,form_id,form_version,code,kind,status,source,submitter_contact_id,title)
         VALUES($1,$2,1,9101,'abstract','pending','cfp',$3,'A talk')`,
        [eventId, form.id, contactId],
      );

      const blocked = await deleteFormIn(database, eventId, form.id).catch((error: unknown) => error);
      expect(isAppError(blocked) && blocked.code).toBe("CONFLICT");
      const stillThere = await pglite.query("SELECT id FROM forms WHERE id=$1", [form.id]);
      expect(stillThere.rows).toHaveLength(1);
    });
  });

  it("concurrent-edit safety (M24 §8): a stale-loaded portal form save returns STALE_WRITE, never a silent overwrite", async () => {
    const form = await createFormIn(database, eventId, {
      internalName: "Concurrent edit",
      kind: "abstract",
      collectParticipants: false,
      context: "portal",
      targetType: "contact",
    });
    const first = await updateFormIn(database, eventId, form.id, { externalTitle: "Tab A wins" }, form.updatedAt);
    const stale = await updateFormIn(database, eventId, form.id, { externalTitle: "Tab B loses" }, form.updatedAt).catch((error: unknown) => error);
    expect(isAppError(stale) && stale.code).toBe("STALE_WRITE");
    const reread = await getFormForBuilderIn(database, eventId, form.id);
    expect(reread.externalTitle).toBe("Tab A wins");
    void first;
  });
});
