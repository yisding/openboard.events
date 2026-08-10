import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_TEMPLATES } from "@/features/comms/server/templates";
import { TEMPLATE_KEYS } from "@/shared/contracts";

/**
 * `drizzle/0014_email_template_backfill.sql`.
 *
 * `seedDefaultTemplates` runs at event creation only, so every migration that
 * appended to the `template_key` enum left older events with no row for the new
 * key — and the dispatcher treats a missing row as a *terminal* failure, never
 * retried and never delivered. For `admin_password_reset` that meant an
 * organizer whose home event predates 0009 could never receive a password-reset
 * email, with nothing surfaced to them: the endpoint answers "if this email
 * exists, check your email" either way.
 *
 * The fixture below is that world exactly: an event that exists before 0014
 * runs, carrying only the templates it was seeded with at the time.
 */
const MIGRATIONS_DIR = fileURLToPath(new URL("../../drizzle/", import.meta.url));
const migrationNames = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort();
const BACKFILL = "0014_email_template_backfill.sql";
const eventId = "14000000-0000-4000-8000-000000000001";

describe("0014 email template backfill", () => {
  let pglite: PGlite;

  beforeAll(async () => {
    pglite = new PGlite();
    for (const name of migrationNames) {
      if (name === BACKFILL) break;
      await pglite.exec(readFileSync(`${MIGRATIONS_DIR}${name}`, "utf8"));
    }
    await pglite.query(
      "INSERT INTO events(id,name,slug,starts_at,ends_at) VALUES($1,'Legacy','legacy-templates','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
      [eventId],
    );
    // Seeded the way a pre-0009 event was: the keys that existed then, one of
    // them hand-edited by its organizer.
    await pglite.query(
      `INSERT INTO email_templates(event_id,key,subject,body_html) VALUES
         ($1,'submission_received','Our own subject','<p>our own body</p>'),
         ($1,'portal_login','Your code','<p>code</p>')`,
      [eventId],
    );
    await pglite.query("INSERT INTO reminder_rules(event_id,offset_days) VALUES($1,-1)", [eventId]);
  }, 60_000);

  afterAll(async () => pglite.close());

  it("leaves the pre-0014 event short of the keys added after it was created", async () => {
    const before = await pglite.query<{ n: number }>("SELECT count(*)::int AS n FROM email_templates WHERE event_id=$1", [eventId]);
    expect(before.rows[0]?.n).toBe(2);
    expect(TEMPLATE_KEYS.length).toBeGreaterThan(2);
  });

  it("gives every existing event one row per template key without overwriting an edited one", async () => {
    await pglite.exec(readFileSync(`${MIGRATIONS_DIR}${BACKFILL}`, "utf8"));

    const rows = await pglite.query<{ key: string; subject: string; body_html: string }>(
      "SELECT key, subject, body_html FROM email_templates WHERE event_id=$1", [eventId],
    );
    expect(rows.rows).toHaveLength(TEMPLATE_KEYS.length);
    expect(rows.rows.map((row) => row.key).sort()).toEqual([...TEMPLATE_KEYS].sort());

    // The organizer's edit survives — the backfill is DO NOTHING, never DO
    // UPDATE.
    const edited = rows.rows.find((row) => row.key === "submission_received");
    expect(edited?.subject).toBe("Our own subject");

    // And the rows it did insert carry the same defaults `seedDefaultTemplates`
    // would have used, so a backfilled event is indistinguishable from a
    // freshly created one.
    const reset = rows.rows.find((row) => row.key === "admin_password_reset");
    expect(reset?.subject).toBe(DEFAULT_TEMPLATES.admin_password_reset.subject);
    expect(reset?.body_html).toBe(DEFAULT_TEMPLATES.admin_password_reset.bodyHtml);

    const reminders = await pglite.query<{ offset_days: number }>(
      "SELECT offset_days FROM reminder_rules WHERE event_id=$1 ORDER BY offset_days", [eventId],
    );
    expect(reminders.rows.map((row) => row.offset_days)).toEqual([-7, -1, 1]);
  });

  it("is idempotent — a second run changes nothing", async () => {
    await pglite.exec(readFileSync(`${MIGRATIONS_DIR}${BACKFILL}`, "utf8"));
    const rows = await pglite.query<{ n: number }>("SELECT count(*)::int AS n FROM email_templates WHERE event_id=$1", [eventId]);
    expect(rows.rows[0]?.n).toBe(TEMPLATE_KEYS.length);
  });
});
