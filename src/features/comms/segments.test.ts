import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import { contactIdSchema, eventIdSchema } from "@/shared/contracts";
import { resolveSpeakerSegmentIn } from "./server/segments";

const migration0 = readFileSync(new URL("../../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");
const migrationEmailCompliance = readFileSync(new URL("../../../drizzle/0007_email_compliance.sql", import.meta.url), "utf8");
// workflow_status column.
const migrationRoster = readFileSync(new URL("../../../drizzle/0008_speaker_roster_operations.sql", import.meta.url), "utf8");

const eventId = eventIdSchema.parse("f3000000-0000-4000-8000-000000000001");
const confirmedA = contactIdSchema.parse("f3000000-0000-4000-8000-000000000010");
const confirmedB = contactIdSchema.parse("f3000000-0000-4000-8000-000000000011");
const confirmedUnsubscribed = contactIdSchema.parse("f3000000-0000-4000-8000-000000000012");
const confirmedSuppressed = contactIdSchema.parse("f3000000-0000-4000-8000-000000000013");
const invited = contactIdSchema.parse("f3000000-0000-4000-8000-000000000014");

describe("M46 bulk-send segmentation", () => {
  let pglite: PGlite;
  let tx: TxDb;

  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migration0);
    await pglite.exec(migration1);
    await pglite.exec(migrationEmailCompliance);
    await pglite.exec(migrationRoster);
    tx = drizzle(pglite, { schema }) as unknown as TxDb;

    await pglite.query(
      "INSERT INTO events(id,name,slug,location,timezone,starts_at,ends_at) VALUES ($1,'AI Engineer','ai-engineer','Fort Mason','America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
      [eventId],
    );
    await pglite.query(
      `INSERT INTO contacts(id,event_id,email,first_name,last_name,confirmation_status,workflow_status) VALUES
        ($1,$6,'a@example.com','Ada','A','confirmed','confirmed'),
        ($2,$6,'b@example.com','Bea','B','confirmed','confirmed'),
        ($3,$6,'c@example.com','Cal','C','confirmed','confirmed'),
        ($4,$6,'d@example.com','Dee','D','confirmed','confirmed'),
        ($5,$6,'e@example.com','Eve','E','unconfirmed','invited')`,
      [confirmedA, confirmedB, confirmedUnsubscribed, confirmedSuppressed, invited, eventId],
    );
    await pglite.query("UPDATE contacts SET unsubscribed_at = now() WHERE id=$1", [confirmedUnsubscribed]);
    await pglite.query("INSERT INTO contact_suppressions(contact_id,event_id,reason) VALUES ($1,$2,'bounce')", [confirmedSuppressed, eventId]);
  }, 30_000);

  afterAll(async () => pglite.close());

  it("an empty filter matches every contact in the event, minus suppressed/unsubscribed", async () => {
    const resolved = await resolveSpeakerSegmentIn(tx, eventId, {});
    expect(resolved.matchedCount).toBe(5);
    expect(resolved.contactIds.sort()).toEqual([confirmedA, confirmedB, invited].sort());
    expect(resolved.excludedSuppressedCount).toBe(1);
    expect(resolved.excludedUnsubscribedCount).toBe(1);
    expect(resolved.capped).toBe(false);
  });

  it("filters by workflow status", async () => {
    const resolved = await resolveSpeakerSegmentIn(tx, eventId, { workflowStatus: ["invited"] });
    expect(resolved.matchedCount).toBe(1);
    expect(resolved.contactIds).toEqual([invited]);
    expect(resolved.excludedSuppressedCount).toBe(0);
    expect(resolved.excludedUnsubscribedCount).toBe(0);
  });

  it("combines workflow and confirmation status with AND, not OR", async () => {
    const resolved = await resolveSpeakerSegmentIn(tx, eventId, { workflowStatus: ["invited"], confirmationStatus: ["confirmed"] });
    expect(resolved.matchedCount).toBe(0);
    expect(resolved.contactIds).toEqual([]);
  });

  it("includes a short preview sample with recipient email/name", async () => {
    const resolved = await resolveSpeakerSegmentIn(tx, eventId, { confirmationStatus: ["confirmed"] });
    expect(resolved.preview.length).toBeGreaterThan(0);
    expect(resolved.preview.every((row) => row.email && row.name)).toBe(true);
  });
});
