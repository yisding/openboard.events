import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbOrTx } from "@/db/client";
import * as schema from "@/db/schema";
import { createFormIn, getFormForBuilderIn } from "@/features/forms";
import { eventIdSchema, type FormId } from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";
import { saveNotificationsStepIn, saveSettingsStepIn } from "./settings-mutations";

const migration0 = readFileSync(new URL("../../../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");
const eventId = eventIdSchema.parse("ae000000-0000-4000-8000-000000000002");

describe("settings-mutations — Settings/Notifications steps (M14)", () => {
  let pglite: PGlite;
  let database: DbOrTx;
  let formId: FormId;

  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migration0);
    await pglite.exec(migration1);
    database = drizzle(pglite, { schema }) as unknown as DbOrTx;
    await pglite.query(
      "INSERT INTO events(id,name,slug,timezone,starts_at,ends_at) VALUES($1,'Settings Conf','settings-conf','America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
      [eventId],
    );
    const form = await createFormIn(database, eventId, { internalName: "CFP", kind: "abstract", collectParticipants: true });
    formId = form.id;
  }, 60_000);

  afterAll(async () => {
    await pglite.close();
  });

  describe("saveSettingsStepIn — submission-limit range", () => {
    it("rejects 0 (below the 1..50 range the number input allows)", async () => {
      const form = await getFormForBuilderIn(database, eventId, formId);
      const error = await saveSettingsStepIn(database, eventId, formId, { submissionLimit: 0 }, form.updatedAt).catch((thrown: unknown) => thrown);
      expect(isAppError(error) && error.code).toBe("VALIDATION");
    });

    it("rejects 51 (above the 1..50 range)", async () => {
      const form = await getFormForBuilderIn(database, eventId, formId);
      const error = await saveSettingsStepIn(database, eventId, formId, { submissionLimit: 51 }, form.updatedAt).catch((thrown: unknown) => thrown);
      expect(isAppError(error) && error.code).toBe("VALIDATION");
    });

    it("accepts a limit inside the range and persists it", async () => {
      const form = await getFormForBuilderIn(database, eventId, formId);
      const updated = await saveSettingsStepIn(database, eventId, formId, { submissionLimit: 5 }, form.updatedAt);
      expect(updated.submissionLimit).toBe(5);
    });

    it("clearing the limit (null) is always legal", async () => {
      const form = await getFormForBuilderIn(database, eventId, formId);
      const updated = await saveSettingsStepIn(database, eventId, formId, { submissionLimit: null }, form.updatedAt);
      expect(updated.submissionLimit).toBeNull();
    });

    it("closesAt is stored as the UTC instant it was given, unconverted (the DateTimePicker already converted it)", async () => {
      const form = await getFormForBuilderIn(database, eventId, formId);
      const closesAt = "2026-09-16T06:59:59.999Z";
      const updated = await saveSettingsStepIn(database, eventId, formId, { closesAt }, form.updatedAt);
      expect(updated.closesAt).toBe(closesAt);
    });
  });

  describe("saveNotificationsStepIn — Submission Confirmation template validation", () => {
    it("rejects an unknown token and writes nothing", async () => {
      const before = await getFormForBuilderIn(database, eventId, formId);
      const error = await saveNotificationsStepIn(database, eventId, formId, {
        confirmationBodyHtml: "<p>Hi {{speaker_bio}}</p>",
      }, before.updatedAt).catch((thrown: unknown) => thrown);
      expect(isAppError(error) && error.code).toBe("TEMPLATE_VAR_MISSING");
      expect(isAppError(error) && error.message).toContain("speaker_bio");
      const after = await getFormForBuilderIn(database, eventId, formId);
      expect(after.confirmationBodyHtml).toBe(before.confirmationBodyHtml);
      expect(after.updatedAt).toBe(before.updatedAt);
    });

    it("checks subject and body together: a subject-only save still trips a bad token already sitting in the stored body", async () => {
      // Store a bad body directly (bypassing validation) to simulate "already
      // there from before this guard existed", then confirm a subject-only
      // patch still refuses to write — the pair is validated as a whole.
      await pglite.query("UPDATE forms SET confirmation_body_html = $1 WHERE id = $2", ["<p>{{not.a.real.token}}</p>", formId]);
      const before = await getFormForBuilderIn(database, eventId, formId);
      expect(before.confirmationBodyHtml).toContain("not.a.real.token");
      const error = await saveNotificationsStepIn(database, eventId, formId, {
        confirmationSubject: "We got your talk",
      }, before.updatedAt).catch((thrown: unknown) => thrown);
      expect(isAppError(error) && error.code).toBe("TEMPLATE_VAR_MISSING");
      // Clean up for the following tests.
      await pglite.query("UPDATE forms SET confirmation_body_html = $1 WHERE id = $2", ["", formId]);
    });

    it("accepts known tokens and sanitizes the body on write", async () => {
      const before = await getFormForBuilderIn(database, eventId, formId);
      const updated = await saveNotificationsStepIn(database, eventId, formId, {
        confirmationSubject: "Thanks for submitting, {{speaker.first_name}}",
        confirmationBodyHtml: "<p>{{submission.title}} (#{{submission.code}})</p><script>alert(1)</script>",
      }, before.updatedAt);
      expect(updated.confirmationSubject).toBe("Thanks for submitting, {{speaker.first_name}}");
      expect(updated.confirmationBodyHtml).not.toContain("<script");
      expect(updated.confirmationBodyHtml).toContain("{{submission.title}}");
    });

    it("leaving both blank is legal (falls back to the event's default template)", async () => {
      const before = await getFormForBuilderIn(database, eventId, formId);
      const updated = await saveNotificationsStepIn(database, eventId, formId, {
        confirmationSubject: "",
        confirmationBodyHtml: "",
      }, before.updatedAt);
      expect(updated.confirmationSubject).toBe("");
      expect(updated.confirmationBodyHtml).toBe("");
    });
  });
});
