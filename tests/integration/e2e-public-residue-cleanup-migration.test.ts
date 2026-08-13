import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migration0 = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
const cleanup = readFileSync(new URL("../../drizzle/0030_e2e_public_residue_cleanup.sql", import.meta.url), "utf8");

describe("E2E public residue cleanup migration", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(migration0);
    await db.exec(`
      INSERT INTO events(id,name,slug,starts_at,ends_at)
      VALUES('e3000000-0000-4000-8000-000000000001','Existing event','ai-engineer-sandbox-event','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z');

      INSERT INTO sessions(event_id,title,slug,status) VALUES
        ('e3000000-0000-4000-8000-000000000001','E2E publish me 1786426655719','test-published','published'),
        ('e3000000-0000-4000-8000-000000000001','E2E overlap A 1786426655720','test-overlap','draft'),
        ('e3000000-0000-4000-8000-000000000001','E2E content history edit two 1786426655721','test-content','published'),
        ('e3000000-0000-4000-8000-000000000001','E2E publishing lessons 1786426655722','real-e2e-session','published'),
        ('e3000000-0000-4000-8000-000000000001','E2E publish me someday','not-a-test-timestamp','published');

      INSERT INTO contacts(id,event_id,email,first_name,bio_html,confirmation_status) VALUES
        ('e3000000-0000-4000-8000-000000000005','e3000000-0000-4000-8000-000000000001','ada@example.com','Ada','<p><strong>E2E bio 1786423950034</strong>Ada works on analytical engines.</p>','confirmed'),
        ('e3000000-0000-4000-8000-000000000002','e3000000-0000-4000-8000-000000000001','alan@example.com','Alan','<p><strong>E2E bio 1786426713749E2E bio 1786423950035</strong>Alan works on cryptanalysis.</p>','confirmed'),
        ('e3000000-0000-4000-8000-000000000003','e3000000-0000-4000-8000-000000000001','writer@example.com','Writer','<p>My E2E bio 1786423950036 is legitimate prose.</p>','declined'),
        ('e3000000-0000-4000-8000-000000000004','e3000000-0000-4000-8000-000000000001','words@example.com','Words','<p>E2E bio is a phrase without a test timestamp.</p>','confirmed'),
        ('8c33e03d-60c7-58ac-b4a6-2e56b80f829b','e3000000-0000-4000-8000-000000000001','grace@example.com','Grace','<p>Grace works on compilers.</p>','declined');
    `);
    // Data repair migrations should be safe if an operator has to rerun the
    // SQL while diagnosing an interrupted deploy.
    await db.exec(cleanup);
    await db.exec(cleanup);
  });

  afterAll(async () => db.close());

  it("deletes only timestamp-shaped browser-test sessions", async () => {
    const sessions = await db.query<{ title: string }>("SELECT title FROM sessions ORDER BY title");
    expect(sessions.rows.map(({ title }) => title)).toEqual([
      "E2E publish me someday",
      "E2E publishing lessons 1786426655722",
    ]);
  });

  it("strips repeated leading test markers and preserves real biography content", async () => {
    const contacts = await db.query<{ email: string; bio_html: string }>(
      "SELECT email,bio_html FROM contacts ORDER BY email",
    );
    expect(contacts.rows).toEqual([
      { email: "ada@example.com", bio_html: "<p>Ada works on analytical engines.</p>" },
      { email: "alan@example.com", bio_html: "<p>Alan works on cryptanalysis.</p>" },
      { email: "grace@example.com", bio_html: "<p>Grace works on compilers.</p>" },
      { email: "words@example.com", bio_html: "<p>E2E bio is a phrase without a test timestamp.</p>" },
      { email: "writer@example.com", bio_html: "<p>My E2E bio 1786423950036 is legitimate prose.</p>" },
    ]);
  });

  it("reconfirms only the exact seeded Grace row in the demo event", async () => {
    const contacts = await db.query<{ email: string; confirmation_status: string }>(
      "SELECT email,confirmation_status FROM contacts WHERE email IN ('grace@example.com','writer@example.com') ORDER BY email",
    );
    expect(contacts.rows).toEqual([
      { email: "grace@example.com", confirmation_status: "confirmed" },
      { email: "writer@example.com", confirmation_status: "declined" },
    ]);
  });
});
