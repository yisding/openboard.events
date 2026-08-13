import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbOrTx, TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import { tryRecordEventOnboardingMilestoneIn } from "@/features/product-signals";
import { eventIdSchema } from "@/shared/contracts";
import { createFormIn, updateFormIn, updateFormWithAvailabilityReplayIn } from "./builder-mutations";
import { getFormForBuilderIn } from "./builder-queries";

const migrations = [
  "../../../../drizzle/0000_init.sql",
  "../../../../drizzle/0001_views_triggers.sql",
  "../../../../drizzle/0004_review_operations.sql",
  "../../../../drizzle/0010_organization_tenancy.sql",
  "../../../../drizzle/0023_onboarding_milestones.sql",
].map((path) => readFileSync(new URL(path, import.meta.url), "utf8"));

const eventId = eventIdSchema.parse("a9000000-0000-4000-8000-000000000001");

describe("atomic form authoring update", () => {
  let pg: PGlite;
  let database: DbOrTx;

  beforeAll(async () => {
    pg = new PGlite();
    for (const migration of migrations) await pg.exec(migration);
    database = drizzle(pg, { schema }) as unknown as DbOrTx;
    await pg.query(
      `INSERT INTO events(id,name,slug,timezone,starts_at,ends_at)
       VALUES ($1,'Atomic Forms Conf','atomic-forms-conf','America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')`,
      [eventId],
    );
  }, 60_000);

  afterAll(async () => pg.close());

  it("rolls back availability, CAS metadata, and versions when snapshot persistence fails", async () => {
    const form = await createFormIn(database, eventId, {
      internalName: "Main CFP",
      kind: "abstract",
      collectParticipants: true,
    });
    const beforeForm = await pg.query<{
      status: string;
      updated_at: string;
      row_version: number;
      current_version: number;
    }>(
      "SELECT status, updated_at::text, row_version, current_version FROM forms WHERE id=$1",
      [form.id],
    );
    const beforeVersions = await pg.query<{ versions: number }>(
      "SELECT count(*)::int AS versions FROM form_versions WHERE form_id=$1",
      [form.id],
    );

    await pg.exec(`
      CREATE FUNCTION fail_form_version_persistence() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'forced form version persistence failure';
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_form_version_persistence
      BEFORE INSERT ON form_versions
      FOR EACH ROW EXECUTE FUNCTION fail_form_version_persistence();
    `);

    try {
      await expect(database.transaction((tx) => updateFormIn(
        tx as unknown as TxDb,
        eventId,
        form.id,
        { status: "open" },
        form.updatedAt,
      ))).rejects.toThrow('Failed query: insert into "form_versions"');

      const afterForm = await pg.query<{
        status: string;
        updated_at: string;
        row_version: number;
        current_version: number;
      }>(
        "SELECT status, updated_at::text, row_version, current_version FROM forms WHERE id=$1",
        [form.id],
      );
      const afterVersions = await pg.query<{ versions: number }>(
        "SELECT count(*)::int AS versions FROM form_versions WHERE form_id=$1",
        [form.id],
      );

      expect(afterForm.rows).toEqual(beforeForm.rows);
      expect(afterVersions.rows).toEqual(beforeVersions.rows);
    } finally {
      await pg.exec("DROP TRIGGER fail_form_version_persistence ON form_versions; DROP FUNCTION fail_form_version_persistence();");
    }
  });

  it("keeps committed availability and snapshot changes when the post-commit milestone fails", async () => {
    const form = await createFormIn(database, eventId, {
      internalName: "Milestone failure CFP",
      kind: "abstract",
      collectParticipants: true,
    });
    const opened = await database.transaction((tx) => updateFormWithAvailabilityReplayIn(
      tx as unknown as TxDb,
      eventId,
      form.id,
      { status: "open" },
      form.updatedAt,
      false,
    ));

    await pg.exec(`
      CREATE FUNCTION fail_form_publication_milestone() RETURNS trigger AS $$
      BEGIN
        IF NEW.milestone = 'form_published' THEN
          RAISE EXCEPTION 'forced milestone failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_form_publication_milestone
      BEFORE INSERT ON organization_onboarding_milestones
      FOR EACH ROW EXECUTE FUNCTION fail_form_publication_milestone();
    `);

    try {
      await expect(tryRecordEventOnboardingMilestoneIn(database, eventId, "form_published")).resolves.toBe(false);
      const stored = await pg.query<{
        status: string;
        row_version: number;
        current_version: number;
        versions: number;
      }>(
        `SELECT f.status, f.row_version, f.current_version,
          (SELECT count(*)::int FROM form_versions v WHERE v.form_id=f.id) AS versions
         FROM forms f WHERE f.id=$1`,
        [form.id],
      );
      expect(opened).toMatchObject({ status: "open", currentVersion: 2 });
      expect(stored.rows).toEqual([{ status: "open", row_version: 2, current_version: 2, versions: 2 }]);
    } finally {
      await pg.exec("DROP TRIGGER fail_form_publication_milestone ON organization_onboarding_milestones; DROP FUNCTION fail_form_publication_milestone();");
    }
  });

  it("returns authoritative state for a same-status stale availability replay without another version", async () => {
    const form = await createFormIn(database, eventId, {
      internalName: "Same-status replay CFP",
      kind: "abstract",
      collectParticipants: true,
    });
    await pg.query("UPDATE forms SET updated_at='2026-01-01T00:00:00Z' WHERE id=$1", [form.id]);
    const baseline = await getFormForBuilderIn(database, eventId, form.id);
    await expect(database.transaction((tx) => updateFormWithAvailabilityReplayIn(
      tx as unknown as TxDb,
      eventId,
      form.id,
      { status: "open", externalTitle: "Not availability-only" },
      baseline.updatedAt,
      true,
    ))).rejects.toMatchObject({ code: "VALIDATION" });
    const opened = await database.transaction((tx) => updateFormWithAvailabilityReplayIn(
      tx as unknown as TxDb,
      eventId,
      form.id,
      { status: "open" },
      baseline.updatedAt,
      false,
    ));
    await expect(database.transaction((tx) => updateFormWithAvailabilityReplayIn(
      tx as unknown as TxDb,
      eventId,
      form.id,
      { status: "open" },
      baseline.updatedAt,
      false,
    ))).rejects.toMatchObject({ code: "STALE_WRITE" });
    await expect(database.transaction((tx) => updateFormWithAvailabilityReplayIn(
      tx as unknown as TxDb,
      eventId,
      form.id,
      { status: "open", externalTitle: "Not availability-only" },
      baseline.updatedAt,
      true,
    ))).rejects.toMatchObject({ code: "VALIDATION" });
    const replayed = await database.transaction((tx) => updateFormWithAvailabilityReplayIn(
      tx as unknown as TxDb,
      eventId,
      form.id,
      { status: "open" },
      baseline.updatedAt,
      true,
    ));
    const versions = await pg.query<{ versions: number }>(
      "SELECT count(*)::int AS versions FROM form_versions WHERE form_id=$1",
      [form.id],
    );

    expect(replayed).toMatchObject({
      status: "open",
      currentVersion: opened.currentVersion,
      updatedAt: opened.updatedAt,
    });
    expect(versions.rows).toEqual([{ versions: 2 }]);
  });

  it("preserves STALE_WRITE when an availability replay finds a different current status", async () => {
    const form = await createFormIn(database, eventId, {
      internalName: "Differing-status replay CFP",
      kind: "abstract",
      collectParticipants: true,
    });
    await pg.query("UPDATE forms SET updated_at='2026-01-02T00:00:00Z' WHERE id=$1", [form.id]);
    const baseline = await getFormForBuilderIn(database, eventId, form.id);
    await database.transaction((tx) => updateFormIn(
      tx as unknown as TxDb,
      eventId,
      form.id,
      { externalTitle: "A concurrent edit" },
      baseline.updatedAt,
    ));

    await expect(database.transaction((tx) => updateFormWithAvailabilityReplayIn(
      tx as unknown as TxDb,
      eventId,
      form.id,
      { status: "open" },
      baseline.updatedAt,
      true,
    ))).rejects.toMatchObject({ code: "STALE_WRITE" });
    const current = await getFormForBuilderIn(database, eventId, form.id);
    expect(current).toMatchObject({ status: "draft", currentVersion: 2, externalTitle: "A concurrent edit" });
  });
});
