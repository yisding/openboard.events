import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbOrTx, TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import { eventIdSchema } from "@/shared/contracts";
import type { BuilderForm } from "../builder-types";
import type { ParticipantStepOperation } from "../participant-step";
import { createFormIn, updateParticipantStepWithReplayIn } from "./builder-mutations";
import { getFormForBuilderIn } from "./builder-queries";

const migrations = [
  "../../../../drizzle/0000_init.sql",
  "../../../../drizzle/0001_views_triggers.sql",
  "../../../../drizzle/0004_review_operations.sql",
  "../../../../drizzle/0010_organization_tenancy.sql",
].map((path) => readFileSync(new URL(path, import.meta.url), "utf8"));

const eventId = eventIdSchema.parse("b9000000-0000-4000-8000-000000000001");

function participantSection(form: BuilderForm) {
  const section = form.sections.find((candidate) => candidate.key === "participant");
  if (!section) throw new Error("participant section missing from fixture");
  return section;
}

function operation(form: BuilderForm, patch: Partial<ParticipantStepOperation> = {}): ParticipantStepOperation {
  return {
    expectedUpdatedAt: form.updatedAt,
    sectionId: participantSection(form).id,
    participantRoles: [
      { role: "speaker", enabled: false },
      { role: "co_speaker", enabled: true },
      { role: "moderator", enabled: false },
      { role: "panelist", enabled: false },
    ],
    section: {
      title: "Speaker details",
      pageHeading: "About you",
      descriptionHtml: "<p>Tell us who is presenting.</p>",
    },
    ...patch,
  };
}

describe("atomic participant-step save", () => {
  let pg: PGlite;
  let database: DbOrTx;

  beforeAll(async () => {
    pg = new PGlite();
    for (const migration of migrations) await pg.exec(migration);
    database = drizzle(pg, { schema }) as unknown as DbOrTx;
    await pg.query(
      `INSERT INTO events(id,name,slug,timezone,starts_at,ends_at)
       VALUES ($1,'Participant Save Conf','participant-save-conf','America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')`,
      [eventId],
    );
  }, 60_000);

  afterAll(async () => pg.close());

  function run(
    formId: BuilderForm["id"],
    request: ParticipantStepOperation,
    replay = false,
  ): Promise<BuilderForm> {
    return database.transaction((tx) => updateParticipantStepWithReplayIn(
      tx as unknown as TxDb,
      eventId,
      formId,
      request,
      replay,
    ));
  }

  async function create(name: string, updatedAt: string): Promise<BuilderForm> {
    const created = await createFormIn(database, eventId, {
      internalName: name,
      kind: "abstract",
      collectParticipants: true,
    });
    await pg.query("UPDATE forms SET updated_at=$2 WHERE id=$1", [created.id, updatedAt]);
    return getFormForBuilderIn(database, eventId, created.id);
  }

  it("commits normalized roles, section copy, CAS metadata, and exactly one version", async () => {
    const form = await create("Successful participant save", "2026-01-01T00:00:00Z");
    const saved = await run(form.id, operation(form));
    const stored = await pg.query<{ row_version: number; current_version: number; versions: number }>(
      `SELECT f.row_version, f.current_version,
        (SELECT count(*)::int FROM form_versions v WHERE v.form_id=f.id) AS versions
       FROM forms f WHERE f.id=$1`,
      [form.id],
    );

    expect(saved.participantRoles).toEqual([
      { role: "speaker", enabled: true },
      { role: "co_speaker", enabled: true },
      { role: "moderator", enabled: false },
      { role: "panelist", enabled: false },
    ]);
    expect(participantSection(saved)).toMatchObject({
      title: "Speaker details",
      pageHeading: "About you",
      descriptionHtml: "<p>Tell us who is presenting.</p>",
    });
    expect(saved.currentVersion).toBe(2);
    expect(stored.rows).toEqual([{ row_version: 2, current_version: 2, versions: 2 }]);
  });

  it("rolls back roles, section copy, CAS metadata, and the version when snapshot persistence fails", async () => {
    const form = await create("Rolled-back participant save", "2026-01-02T00:00:00Z");
    const section = participantSection(form);
    const beforeForm = await pg.query(
      "SELECT participant_roles, updated_at::text, row_version, current_version FROM forms WHERE id=$1",
      [form.id],
    );
    const beforeSection = await pg.query(
      "SELECT title, page_heading, description_html, updated_at::text FROM form_sections WHERE id=$1",
      [section.id],
    );
    const beforeVersions = await pg.query("SELECT version, snapshot FROM form_versions WHERE form_id=$1 ORDER BY version", [form.id]);

    await pg.exec(`
      CREATE FUNCTION fail_participant_snapshot() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'forced participant snapshot failure';
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_participant_snapshot
      BEFORE INSERT ON form_versions
      FOR EACH ROW EXECUTE FUNCTION fail_participant_snapshot();
    `);

    try {
      await expect(run(form.id, operation(form))).rejects.toThrow('Failed query: insert into "form_versions"');
      expect((await pg.query(
        "SELECT participant_roles, updated_at::text, row_version, current_version FROM forms WHERE id=$1",
        [form.id],
      )).rows).toEqual(beforeForm.rows);
      expect((await pg.query(
        "SELECT title, page_heading, description_html, updated_at::text FROM form_sections WHERE id=$1",
        [section.id],
      )).rows).toEqual(beforeSection.rows);
      expect((await pg.query(
        "SELECT version, snapshot FROM form_versions WHERE form_id=$1 ORDER BY version",
        [form.id],
      )).rows).toEqual(beforeVersions.rows);
    } finally {
      await pg.exec("DROP TRIGGER fail_participant_snapshot ON form_versions; DROP FUNCTION fail_participant_snapshot();");
    }
  });

  it("returns a same-payload stale replay without creating another version", async () => {
    const form = await create("Replayed participant save", "2026-01-03T00:00:00Z");
    const request = operation(form);
    const first = await run(form.id, request);
    await expect(run(form.id, request)).rejects.toMatchObject({ code: "STALE_WRITE" });
    const replayed = await run(form.id, request, true);
    const versions = await pg.query<{ versions: number }>(
      "SELECT count(*)::int AS versions FROM form_versions WHERE form_id=$1",
      [form.id],
    );

    expect(replayed).toMatchObject({ updatedAt: first.updatedAt, currentVersion: first.currentVersion });
    expect(participantSection(replayed)).toMatchObject(request.section);
    expect(versions.rows).toEqual([{ versions: 2 }]);
  });

  it.each([
    {
      name: "roles",
      patch: (original: ParticipantStepOperation): Partial<ParticipantStepOperation> => ({
        participantRoles: [
          { role: "speaker", enabled: true },
          { role: "co_speaker", enabled: false },
          { role: "moderator", enabled: true },
          { role: "panelist", enabled: false },
        ],
        section: original.section,
      }),
    },
    {
      name: "copy",
      patch: (original: ParticipantStepOperation): Partial<ParticipantStepOperation> => ({
        participantRoles: original.participantRoles,
        section: { ...original.section, title: "Concurrent speaker copy" },
      }),
    },
  ])("preserves STALE_WRITE when authoritative $name differ", async ({ name, patch }) => {
    const form = await create(`Conflicting participant ${name}`, name === "roles"
      ? "2026-01-04T00:00:00Z"
      : "2026-01-04T00:01:00Z");
    const original = operation(form);
    const concurrent = operation(form, patch(original));
    await run(form.id, concurrent);

    await expect(run(form.id, original, true)).rejects.toMatchObject({ code: "STALE_WRITE" });
    const current = await getFormForBuilderIn(database, eventId, form.id);
    expect(current.currentVersion).toBe(2);
    if (name === "roles") {
      expect(current.participantRoles.find((role) => role.role === "moderator")?.enabled).toBe(true);
    } else {
      expect(participantSection(current).title).toBe("Concurrent speaker copy");
    }
  });

  it("rejects a non-participant section before touching authoring state", async () => {
    const form = await create("Wrong section participant save", "2026-01-05T00:00:00Z");
    const abstract = form.sections.find((section) => section.key === "abstract");
    if (!abstract) throw new Error("abstract section missing from fixture");
    const before = await pg.query(
      "SELECT updated_at::text, row_version, current_version FROM forms WHERE id=$1",
      [form.id],
    );

    await expect(run(form.id, operation(form, { sectionId: abstract.id }), true))
      .rejects.toMatchObject({ code: "VALIDATION" });
    expect((await pg.query(
      "SELECT updated_at::text, row_version, current_version FROM forms WHERE id=$1",
      [form.id],
    )).rows).toEqual(before.rows);
  });
});
