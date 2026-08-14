import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import { formSnapshotSchema } from "@/shared/contracts";
import { sanitize } from "@/shared/lib/sanitize";
import { seedPortal } from "../../scripts/seed/portal";
import { SEEDED_EMPTY_EVENT_ID, SEEDED_EVENT_ID } from "../../scripts/seed/lib/helpers";
import { seedId } from "../../scripts/seed/lib/ids";

const migration0 = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");
// M50 is additive on top of the base schema; applying it keeps this fixture
// aligned with the columns the repository modules now read.
const migrationReviewOps = readFileSync(new URL("../../drizzle/0004_review_operations.sql", import.meta.url), "utf8");
const migrationParticipantReceipts = readFileSync(new URL("../../drizzle/0032_participant_step_receipts.sql", import.meta.url), "utf8");

describe("portal seed", () => {
  let pglite: PGlite;
  let ctx: { tx: TxDb; now: Date; eventId: typeof SEEDED_EVENT_ID; emptyEventId: typeof SEEDED_EMPTY_EVENT_ID; id: typeof seedId; log: (message: string) => void };
  const logs: string[] = [];

  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migration0);
    await pglite.exec(migration1);
    await pglite.exec(migrationReviewOps);
    await pglite.exec(migrationParticipantReceipts);
    await pglite.query(
      "INSERT INTO events(id,name,slug,starts_at,ends_at) VALUES($1,'Seed Event','seed-event','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
      [SEEDED_EVENT_ID],
    );
    ctx = {
      tx: drizzle(pglite, { schema }) as unknown as TxDb,
      now: new Date("2026-08-09T12:00:00.000Z"),
      eventId: SEEDED_EVENT_ID,
      emptyEventId: SEEDED_EMPTY_EVENT_ID,
      id: seedId,
      log: (message: string) => logs.push(message),
    };
    await seedPortal(ctx);
  }, 60_000);

  afterAll(async () => {
    await pglite.close();
  });

  it("seeds one task per completion mode, with one already overdue", async () => {
    const rows = await pglite.query<{ completion_mode: string; due_at: Date | null }>(
      "SELECT completion_mode, due_at FROM portal_tasks WHERE is_active ORDER BY sort_order",
    );
    expect(rows.rows).toHaveLength(3);
    expect(rows.rows.map((row) => row.completion_mode)).toEqual(["manual", "file_request", "form"]);
    // The overdue row is what keeps the overdue list non-empty and gives the
    // reminder scan something to find on its first tick.
    expect(rows.rows.filter((row) => row.due_at !== null && row.due_at < ctx.now)).toHaveLength(1);
  });

  it("seeds two renderable portal forms and attaches the form task", async () => {
    const forms = await pglite.query<{
      id: string;
      internal_name: string;
      target_type: string;
      current_version: number;
      snapshot: unknown;
    }>(
      `SELECT f.id, f.internal_name, f.target_type, f.current_version, v.snapshot
       FROM forms f
       JOIN form_versions v ON v.form_id = f.id AND v.version = f.current_version
       WHERE f.context = 'portal'
       ORDER BY f.internal_name`,
    );
    expect(forms.rows).toHaveLength(2);
    expect(forms.rows.map((row) => [row.internal_name, row.target_type])).toEqual([
      ["Profile update", "contact"],
      ["Session information", "submission"],
    ]);
    for (const form of forms.rows) {
      expect(form.current_version).toBe(1);
      expect(formSnapshotSchema.parse(form.snapshot).formId).toBe(form.id);
    }

    const mappedFields = await pglite.query<{ maps_to: string }>(
      `SELECT ff.maps_to FROM form_fields ff
       JOIN forms f ON f.id = ff.form_id
       WHERE f.context = 'portal' AND ff.deleted_at IS NULL
       ORDER BY ff.maps_to`,
    );
    expect(mappedFields.rows.map((row) => row.maps_to)).toEqual([
      "contact.bio_html",
      "contact.company",
      "contact.headshot_file_id",
      "contact.job_title",
      "contact.pronouns",
      "submission.description_html",
      "submission.level",
      "submission.title",
    ]);

    const task = await pglite.query<{ form_id: string; context: string; target_type: string }>(
      `SELECT t.form_id, f.context, f.target_type FROM portal_tasks t
       JOIN forms f ON f.id = t.form_id
       WHERE t.completion_mode = 'form'`,
    );
    expect(task.rows).toEqual([{
      form_id: seedId("form", "profile-update"),
      context: "portal",
      target_type: "contact",
    }]);
  });

  it("points the file-request task at a real file request", async () => {
    const rows = await pglite.query<{ file_request_id: string | null; max_size_mb: number }>(
      `SELECT t.file_request_id, r.max_size_mb FROM portal_tasks t
       JOIN file_requests r ON r.id = t.file_request_id
       WHERE t.completion_mode = 'file_request'`,
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.max_size_mb).toBe(100);
  });

  it("keeps the allowlisted embed and strips the script", async () => {
    const rows = await pglite.query<{ slug: string; body_html: string }>("SELECT slug, body_html FROM resource_pages ORDER BY sort_order");
    const [handbook, guidelines] = rows.rows;

    // The two probes are the point of these pages: they render where a judge
    // will actually look, so a sanitizer regression is visible rather than
    // theoretical.
    expect(sanitize(handbook?.body_html ?? "", { profile: "wide" })).toContain("youtube.com/embed");
    expect(sanitize(handbook?.body_html ?? "")).not.toContain("<iframe");
    expect(guidelines?.body_html).toContain("<script>");
    expect(sanitize(guidelines?.body_html ?? "", { profile: "wide" })).not.toContain("<script");
  });

  it("re-runs as a no-op rather than duplicating", async () => {
    await seedPortal(ctx);
    const counts = await pglite.query<{ tasks: number; requests: number; pages: number; forms: number; versions: number }>(
      `SELECT (SELECT count(*)::int FROM portal_tasks) AS tasks,
              (SELECT count(*)::int FROM file_requests) AS requests,
              (SELECT count(*)::int FROM resource_pages) AS pages,
              (SELECT count(*)::int FROM forms WHERE context = 'portal') AS forms,
              (SELECT count(*)::int FROM form_versions) AS versions`,
    );
    expect(counts.rows[0]).toEqual({ tasks: 3, requests: 1, pages: 2, forms: 2, versions: 2 });
  });

  it("preserves organizer edits and immutable published form versions", async () => {
    const formId = seedId("form", "profile-update");
    const sectionId = seedId("section", "profile-update-details");
    const customFieldId = "d0000000-0000-4000-8000-000000000010";
    const versionId = "d0000000-0000-4000-8000-000000000011";
    const version1 = (await pglite.query<{ snapshot: Record<string, unknown> }>(
      "SELECT snapshot FROM form_versions WHERE form_id=$1 AND version=1",
      [formId],
    )).rows[0]?.snapshot;
    if (!version1) throw new Error("seeded version 1 missing");
    const version2 = structuredClone(version1) as {
      version: number;
      sections: Array<{ fields: Array<Record<string, unknown>> }>;
    };
    version2.version = 2;
    version2.sections[0]?.fields.push({
      id: customFieldId,
      key: "custom_note",
      label: "Custom note",
      type: "text",
      required: false,
      locked: false,
      maxChars: null,
      helpText: "",
      options: [],
      visibility: null,
      mapsTo: null,
    });
    await pglite.query(
      "INSERT INTO form_fields(id,event_id,form_id,section_id,key,label,field_type) VALUES($1,$2,$3,$4,'custom_note','Custom note','text')",
      [customFieldId, SEEDED_EVENT_ID, formId, sectionId],
    );
    await pglite.query(
      "INSERT INTO form_versions(id,event_id,form_id,version,snapshot) VALUES($1,$2,$3,2,$4::jsonb)",
      [versionId, SEEDED_EVENT_ID, formId, JSON.stringify(version2)],
    );
    await pglite.query(
      "UPDATE forms SET external_title='Organizer-edited profile', current_version=2 WHERE id=$1",
      [formId],
    );

    await seedPortal(ctx);

    const form = await pglite.query<{ external_title: string; current_version: number }>(
      "SELECT external_title,current_version FROM forms WHERE id=$1",
      [formId],
    );
    expect(form.rows[0]).toEqual({ external_title: "Organizer-edited profile", current_version: 2 });
    expect((await pglite.query<{ snapshot: Record<string, unknown> }>(
      "SELECT snapshot FROM form_versions WHERE form_id=$1 AND version=1",
      [formId],
    )).rows[0]?.snapshot).toEqual(version1);
    expect((await pglite.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM form_fields WHERE id=$1 AND deleted_at IS NULL",
      [customFieldId],
    )).rows[0]?.count).toBe(1);
  });

  it("skips rather than crashing when the event has not been seeded yet", async () => {
    // events.ts is still a no-op in the orchestrator, so a fresh run reaches this
    // module with no event row. Failing a foreign key here would take the whole
    // seed down for a module that has not run.
    const empty = new PGlite();
    await empty.exec(migration0);
    await empty.exec(migration1);
    await empty.exec(migrationReviewOps);
    await empty.exec(migrationParticipantReceipts);
    const messages: string[] = [];
    await seedPortal({
      ...ctx,
      tx: drizzle(empty, { schema }) as unknown as TxDb,
      log: (message: string) => messages.push(message),
    });
    expect(messages[0]).toContain("the event does not exist yet");
    await empty.close();
  }, 60_000);

  it("repairs task and attachment rows back to the seeded contract", async () => {
    await pglite.query(
      "UPDATE portal_tasks SET target_type='submission', completion_mode='manual', form_id=NULL, is_active=false, sort_order=99 WHERE id=$1",
      [seedId("task", "update-profile")],
    );
    await pglite.query("UPDATE file_requests SET target_type='submission' WHERE id=$1", [seedId("file_request", "slides")]);
    await seedPortal(ctx);
    const rows = await pglite.query<{
      target_type: string;
      completion_mode: string;
      form_id: string | null;
      is_active: boolean;
      sort_order: number;
    }>(
      "SELECT target_type,completion_mode,form_id,is_active,sort_order FROM portal_tasks WHERE id=$1",
      [seedId("task", "update-profile")],
    );
    expect(rows.rows[0]).toEqual({
      target_type: "contact",
      completion_mode: "form",
      form_id: seedId("form", "profile-update"),
      is_active: true,
      sort_order: 2,
    });
    expect((await pglite.query<{ target_type: string }>(
      "SELECT target_type FROM file_requests WHERE id=$1",
      [seedId("file_request", "slides")],
    )).rows[0]?.target_type).toBe("contact");
  });

  it("records a completion once contacts exist, and none before", async () => {
    expect((await pglite.query<{ count: number }>("SELECT count(*)::int AS count FROM task_completions")).rows[0]?.count).toBe(0);
    const contactId = "d0000000-0000-4000-8000-000000000002";
    await pglite.query(
      "INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES($1,$2,'speaker@example.com','Test','Speaker')",
      [contactId, SEEDED_EVENT_ID],
    );
    await seedPortal(ctx);
    const rows = await pglite.query<{ contact_id: string; completed_via: string }>("SELECT contact_id, completed_via FROM task_completions");
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toEqual({ contact_id: contactId, completed_via: "manual" });
  });

  it("retires the legacy travel task without rewriting its completion evidence", async () => {
    const legacyTaskId = seedId("task", "travel-form");
    const contactId = "d0000000-0000-4000-8000-000000000002";
    await pglite.query(
      `INSERT INTO portal_tasks(id,event_id,name,completion_mode) VALUES($1,$2,'Tell us about your travel','manual')
       ON CONFLICT (id) DO UPDATE SET is_active=true`,
      [legacyTaskId, SEEDED_EVENT_ID],
    );
    await pglite.query(
      "INSERT INTO task_completions(id,event_id,task_id,contact_id,completed_via) VALUES($1,$2,$3,$4,'manual')",
      ["d0000000-0000-4000-8000-000000000012", SEEDED_EVENT_ID, legacyTaskId, contactId],
    );

    await seedPortal(ctx);

    const legacy = await pglite.query<{ name: string; completion_mode: string; is_active: boolean }>(
      "SELECT name,completion_mode,is_active FROM portal_tasks WHERE id=$1",
      [legacyTaskId],
    );
    expect(legacy.rows[0]).toEqual({
      name: "Tell us about your travel",
      completion_mode: "manual",
      is_active: false,
    });
    expect((await pglite.query<{ completed_via: string }>(
      "SELECT completed_via FROM task_completions WHERE task_id=$1",
      [legacyTaskId],
    )).rows).toEqual([{ completed_via: "manual" }]);
  });

  it("leaves the empty event empty", async () => {
    const rows = await pglite.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM portal_tasks WHERE event_id = $1",
      [SEEDED_EMPTY_EVENT_ID],
    );
    expect(rows.rows[0]?.count).toBe(0);
  });
});
