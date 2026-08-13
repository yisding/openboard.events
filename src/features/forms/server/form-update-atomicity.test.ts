import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbOrTx, TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import { eventIdSchema } from "@/shared/contracts";
import { createFormIn, updateFormIn } from "./builder-mutations";

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
  });
});
