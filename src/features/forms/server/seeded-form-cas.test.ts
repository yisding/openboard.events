import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbOrTx } from "@/db/client";
import * as schema from "@/db/schema";
import { eventIdSchema, type FormId } from "@/shared/contracts";
import { applyProductMigrations } from "../../../../scripts/lib/product-migrations";
import { createFormIn, updateFieldIn } from "./builder-mutations";
import { getFormForBuilderIn } from "./builder-queries";

const eventId = eventIdSchema.parse("a9000000-0000-4000-8000-0000000000c4");

/**
 * Regression cover for #624: a form whose `updated_at` was written by Postgres
 * rather than by this codebase rejected every builder edit with 409
 * STALE_WRITE.
 *
 * `scripts/seed/forms.ts` inserts `forms` without an `updated_at`, so the row
 * takes `DEFAULT now()` — microsecond resolution. The builder's CAS token is a
 * `Date#toISOString()` round trip of that column, which stops at milliseconds,
 * so the token could never match the row it came from and a locally seeded
 * form was permanently uneditable.
 *
 * The microsecond remainder is written explicitly instead of leaned on: real
 * Postgres `now()` always lands on a microsecond, but PGlite's clock only
 * offers milliseconds, so a test that relied on the column default would pass
 * here for a reason that does not exist in production.
 */
describe("builder writes against a form Postgres timestamped", () => {
  let pglite: PGlite;
  let database: DbOrTx;
  let formId: FormId;

  beforeAll(async () => {
    pglite = new PGlite();
    await applyProductMigrations(pglite);
    database = drizzle(pglite, { schema }) as unknown as DbOrTx;
    await pglite.query(
      `INSERT INTO events(id,name,slug,timezone,starts_at,ends_at)
       VALUES ($1,'Seeded Forms Conf','seeded-forms-conf','America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')`,
      [eventId],
    );
    const form = await createFormIn(database, eventId, {
      internalName: "Speak at Seeded Forms Conf",
      kind: "abstract",
      collectParticipants: true,
    });
    formId = form.id;
    await pglite.query(
      "UPDATE forms SET updated_at = updated_at + interval '456 microseconds' WHERE id = $1",
      [formId],
    );
  }, 180_000);

  afterAll(async () => {
    await pglite.close();
  });

  async function loadDescriptionField() {
    const form = await getFormForBuilderIn(database, eventId, formId);
    const field = form.sections.flatMap((section) => section.fields)
      .find((candidate) => candidate.key === "description");
    if (!field) throw new Error("the created CFP form has no description question");
    return { form, field };
  }

  it("accepts a field patch composed against the timestamp the builder was served", async () => {
    const { form, field } = await loadDescriptionField();

    const updated = await updateFieldIn(
      database,
      eventId,
      formId,
      field.id,
      { helpText: "Two paragraphs is plenty." },
      form.updatedAt,
    );

    const patched = updated.sections.flatMap((section) => section.fields)
      .find((candidate) => candidate.id === field.id);
    expect(patched?.helpText).toBe("Two paragraphs is plenty.");
    expect(updated.currentVersion).toBe(form.currentVersion + 1);
  });

  it("still refuses a patch composed against an older timestamp", async () => {
    const { form, field } = await loadDescriptionField();

    await expect(updateFieldIn(
      database,
      eventId,
      formId,
      field.id,
      { helpText: "Composed against a copy that has moved on." },
      new Date(new Date(form.updatedAt).getTime() - 1000).toISOString(),
    )).rejects.toMatchObject({ code: "STALE_WRITE" });
  });
});
