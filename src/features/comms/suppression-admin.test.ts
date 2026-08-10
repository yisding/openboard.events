import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import { contactIdSchema, eventIdSchema } from "@/shared/contracts";
import { listSuppressionsIn, removeSuppressionIn } from "./server/suppression";

const migration0 = readFileSync(new URL("../../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");
const migrationEmailCompliance = readFileSync(new URL("../../../drizzle/0007_email_compliance.sql", import.meta.url), "utf8");

const eventId = eventIdSchema.parse("f1000000-0000-4000-8000-000000000001");
const otherEventId = eventIdSchema.parse("f1000000-0000-4000-8000-000000000002");
const bounced = contactIdSchema.parse("f1000000-0000-4000-8000-000000000010");
const complained = contactIdSchema.parse("f1000000-0000-4000-8000-000000000011");
const otherEventContact = contactIdSchema.parse("f1000000-0000-4000-8000-000000000012");

describe("M46 suppression list admin UI", () => {
  let pglite: PGlite;
  let tx: TxDb;

  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migration0);
    await pglite.exec(migration1);
    await pglite.exec(migrationEmailCompliance);
    tx = drizzle(pglite, { schema }) as unknown as TxDb;

    await pglite.query(
      "INSERT INTO events(id,name,slug,location,timezone,starts_at,ends_at) VALUES ($1,'AI Engineer','ai-engineer','Fort Mason','America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z'), ($2,'Other Event','other-event','Nowhere','America/Los_Angeles','2026-10-01T16:00:00Z','2026-10-02T01:00:00Z')",
      [eventId, otherEventId],
    );
    await pglite.query(
      "INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES ($1,$4,'bounced@example.com','Bea','Bounced'), ($2,$4,'complained@example.com','Cal','Complained'), ($3,$5,'other-event@example.com','Otto','Elsewhere')",
      [bounced, complained, otherEventContact, eventId, otherEventId],
    );
    await pglite.query("INSERT INTO contact_suppressions(contact_id,event_id,reason) VALUES ($1,$3,'bounce'), ($2,$3,'complaint')", [bounced, complained, eventId]);
    await pglite.query("INSERT INTO contact_suppressions(contact_id,event_id,reason) VALUES ($1,$2,'bounce')", [otherEventContact, otherEventId]);
  }, 30_000);

  afterAll(async () => pglite.close());

  it("lists only this event's suppressed contacts, newest first, with the recipient joined out", async () => {
    const rows = await listSuppressionsIn(tx, eventId);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.contactId).sort()).toEqual([bounced, complained].sort());
    expect(rows.find((row) => row.contactId === bounced)).toMatchObject({ email: "bounced@example.com", name: "Bea Bounced", reason: "bounce" });
    expect(rows.find((row) => row.contactId === complained)).toMatchObject({ email: "complained@example.com", name: "Cal Complained", reason: "complaint" });
  });

  it("never leaks another event's suppression rows", async () => {
    const rows = await listSuppressionsIn(tx, otherEventId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.contactId).toBe(otherEventContact);
  });

  it("reinstates a suppressed contact: the row disappears from the list and a second reinstate is a no-op", async () => {
    await expect(removeSuppressionIn(tx, eventId, bounced)).resolves.toBe(true);
    const rows = await listSuppressionsIn(tx, eventId);
    expect(rows.map((row) => row.contactId)).toEqual([complained]);
    // Already reinstated — matches nothing, returns false rather than throwing.
    await expect(removeSuppressionIn(tx, eventId, bounced)).resolves.toBe(false);
  });

  it("cannot reinstate a contact suppressed under a different event", async () => {
    await expect(removeSuppressionIn(tx, eventId, otherEventContact)).resolves.toBe(false);
    const rows = await listSuppressionsIn(tx, otherEventId);
    expect(rows).toHaveLength(1);
  });
});
