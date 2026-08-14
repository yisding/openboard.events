import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const base = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../drizzle/0032_participant_step_receipts.sql", import.meta.url), "utf8");

describe("participant operation receipt migration", () => {
  let pg: PGlite;

  beforeAll(async () => {
    pg = new PGlite();
    await pg.exec(base);
    await pg.exec(migration);
  });

  afterAll(async () => pg.close());

  it("requires receipt identity and fingerprint together and scopes operation uniqueness to one form", async () => {
    const columns = await pg.query<{ column_name: string; is_nullable: string }>(`
      SELECT column_name, is_nullable FROM information_schema.columns
      WHERE table_name='form_versions' AND column_name LIKE 'participant_operation_%'
      ORDER BY column_name
    `);
    expect(columns.rows).toEqual([
      { column_name: "participant_operation_fingerprint", is_nullable: "YES" },
      { column_name: "participant_operation_id", is_nullable: "YES" },
    ]);
    const constraints = await pg.query<{ definition: string }>(`
      SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
      WHERE conname='form_versions_participant_operation_pair_ck'
    `);
    expect(constraints.rows[0]?.definition).toContain("participant_operation_id IS NULL");
    expect(constraints.rows[0]?.definition).toContain("participant_operation_fingerprint IS NULL");
    const indexes = await pg.query<{ indexdef: string }>(`
      SELECT indexdef FROM pg_indexes
      WHERE indexname='form_versions_participant_operation_uq'
    `);
    expect(indexes.rows[0]?.indexdef).toContain("event_id, form_id, participant_operation_id");
    expect(indexes.rows[0]?.indexdef).toContain("WHERE (participant_operation_id IS NOT NULL)");
  });
});
