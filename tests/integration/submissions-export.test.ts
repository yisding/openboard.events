import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbOrTx } from "@/db/client";
import * as schema from "@/db/schema";
import { exportSubmissionsCsvIn } from "@/features/submissions/export";
import { submissionFiltersSchema } from "@/features/submissions/server/filters";
import { eventIdSchema } from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";

/**
 * `exportSubmissionsCsvIn` end to end against a real (PGlite) database: it
 * must walk M17's `listSubmissions` — no second SQL statement — strip HTML
 * before it ever reaches `toCsv`, name the event's own timezone in the
 * header, defuse a hostile leading character, and stop at the 5000-row cap
 * with `truncated: true` and no partial row appended.
 */

const migration0 = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");
// M50 is additive on top of the base schema; applying it keeps this fixture
// aligned with the columns the repository modules now read.
const migrationReviewOps = readFileSync(new URL("../../drizzle/0004_review_operations.sql", import.meta.url), "utf8");
// P3-EMAIL added `events.physical_address`; the export loads the event through
// Drizzle, which names every mapped column, so the fixture needs the column.
const migrationEmailCompliance = readFileSync(new URL("../../drizzle/0007_email_compliance.sql", import.meta.url), "utf8");

const eventId = eventIdSchema.parse("e1000000-0000-4000-8000-000000000001");
const capEventId = eventIdSchema.parse("e1000000-0000-4000-8000-000000000002");

let pglite: PGlite;
let db: DbOrTx;

describe("submissions CSV export", () => {
  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migration0);
    await pglite.exec(migration1);
    await pglite.exec(migrationReviewOps);
    await pglite.exec(migrationEmailCompliance);
    db = drizzle(pglite, { schema }) as unknown as DbOrTx;

    for (const [id, slug, timezone] of [
      [eventId, "csv-export", "Asia/Singapore"],
      [capEventId, "csv-export-cap", "America/Los_Angeles"],
    ] as const) {
      await pglite.query(
        "INSERT INTO events(id,name,slug,timezone,starts_at,ends_at) VALUES($1,$2,$3,$4,'2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
        [id, `Event ${slug}`, slug, timezone],
      );
    }

    await pglite.query(
      "INSERT INTO forms(id,event_id,context,internal_name,status,current_version) VALUES(gen_random_uuid(),$1,'cfp','Technical Talks','open',1)",
      [eventId],
    );
    const formRow = (await pglite.query<{ id: string }>(
      "SELECT id FROM forms WHERE event_id = $1",
      [eventId],
    )).rows[0];
    if (!formRow) throw new Error("fixture: form insert did not produce a row");
    const formId = formRow.id;

    // A hostile CFP row: a comma-and-quote-bearing title, an HTML description
    // with an embedded newline that must survive stripping, and a submitted
    // timestamp to exercise the timezone-formatted column.
    await pglite.query(
      `INSERT INTO submissions(event_id,form_id,code,status,source,title,description_html,submitted_at,notified_at)
       VALUES($1,$2,301,'accepted','cfp','Scaling, "safely"','<p>Line one</p>\n<p>Line two</p>',$3,$4)`,
      [eventId, formId, "2026-01-10T18:00:00Z", "2026-01-12T02:00:00Z"],
    );
    // A formula-injection payload for the title, manually added (no form).
    await pglite.query(
      `INSERT INTO submissions(event_id,code,status,source,title)
       VALUES($1,302,'pending','manual','=cmd|' || chr(39) || ' /C calc' || chr(39) || '!A0')`,
      [eventId],
    );
  }, 60_000);

  afterAll(async () => {
    await pglite.close();
  });

  it("walks listSubmissions and produces a header naming the event's own timezone", async () => {
    const result = await exportSubmissionsCsvIn(db, eventId, submissionFiltersSchema.parse({}));
    expect(result.event).toEqual({ slug: "csv-export", timezone: "Asia/Singapore" });
    expect(result.rowCount).toBe(2);
    expect(result.truncated).toBe(false);
    expect(result.csv.split("\r\n")[0]).toContain("Submitted At (Asia/Singapore)");
  });

  it("quotes a comma-and-quote title and preserves the HTML-stripped description across the embedded newline", async () => {
    const result = await exportSubmissionsCsvIn(db, eventId, submissionFiltersSchema.parse({ search: "scaling" }));
    expect(result.rowCount).toBe(1);
    expect(result.csv).toContain("\"Scaling, \"\"safely\"\"\"");
    // regexp_replace turns each `<p>...</p>` boundary into a space, not a
    // dropped newline — the literal `\n` between the two tags survives into
    // the plaintext column verbatim.
    expect(result.csv).toContain("Line one \n Line two");
  });

  it("defuses a leading formula character in a real database-sourced title", async () => {
    const result = await exportSubmissionsCsvIn(db, eventId, submissionFiltersSchema.parse({ search: "cmd" }));
    expect(result.rowCount).toBe(1);
    const dataLine = result.csv.split("\r\n")[1] ?? "";
    // Code, Status, Source, Title — the guarded title is the fourth field.
    // toCsv's own field-value tests already cover the exact escaping; here
    // the point is only that the guard actually reaches a DB-sourced field.
    expect(dataLine.startsWith("SESS-302,pending,Manual,'=cmd|")).toBe(true);
  });

  it("formats Submitted At / Notified At in the event's own zone, and leaves an un-submitted field empty, not the string 'null'", async () => {
    const result = await exportSubmissionsCsvIn(db, eventId, submissionFiltersSchema.parse({ search: "scaling" }));
    // 2026-01-10T18:00:00Z in Asia/Singapore (UTC+8) is 2026-01-11 02:00.
    expect(result.csv).toContain("2026-01-11 02:00");
    // 2026-01-12T02:00:00Z in Asia/Singapore is 2026-01-12 10:00.
    expect(result.csv).toContain("2026-01-12 10:00");
    expect(result.csv).not.toMatch(/,null,/);
  });

  it("throws NOT_FOUND for an event that does not exist", async () => {
    const missing = eventIdSchema.parse("e1000000-0000-4000-8000-000000000099");
    await expect(exportSubmissionsCsvIn(db, missing, submissionFiltersSchema.parse({})))
      .rejects.toSatisfy((error: unknown) => isAppError(error) && error.code === "NOT_FOUND");
  });

  describe("the 5000-row export cap", () => {
    beforeAll(async () => {
      // A bulk INSERT ... SELECT generate_series, not 5000+ round trips: this
      // is a cap test, not a seed-performance test.
      await pglite.query(
        `INSERT INTO submissions(event_id, code, status, source, title, submitted_at)
         SELECT $1, 1000 + g, 'pending', 'cfp', 'Bulk ' || g, now() - (g || ' seconds')::interval
         FROM generate_series(1, 5005) AS g`,
        [capEventId],
      );
    }, 60_000);

    it("stops at exactly 5000 rows, appends no partial row, and reports truncated", async () => {
      const result = await exportSubmissionsCsvIn(db, capEventId, submissionFiltersSchema.parse({}));
      expect(result.rowCount).toBe(5000);
      expect(result.truncated).toBe(true);
      // header + 5000 data records + the trailing empty segment after the last CRLF.
      expect(result.csv.split("\r\n")).toHaveLength(5002);
    });
  });
});
