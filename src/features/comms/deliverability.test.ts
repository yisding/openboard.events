import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import { contactIdSchema, eventIdSchema } from "@/shared/contracts";
import { getDeliverabilityByDomainIn } from "./server/deliverability";

const migration0 = readFileSync(new URL("../../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");
// bounced/complained comm_status labels.
const migrationEmailCompliance = readFileSync(new URL("../../../drizzle/0007_email_compliance.sql", import.meta.url), "utf8");

const eventId = eventIdSchema.parse("f2000000-0000-4000-8000-000000000001");
const otherEventId = eventIdSchema.parse("f2000000-0000-4000-8000-000000000002");
const gmailA = contactIdSchema.parse("f2000000-0000-4000-8000-000000000010");
const gmailB = contactIdSchema.parse("f2000000-0000-4000-8000-000000000011");
const corp = contactIdSchema.parse("f2000000-0000-4000-8000-000000000012");
const otherEventContact = contactIdSchema.parse("f2000000-0000-4000-8000-000000000013");

async function insertLog(pglite: PGlite, args: { event: string; contact: string; status: string; key: string }) {
  await pglite.query(
    "INSERT INTO communication_logs(event_id,contact_id,template_key,idempotency_key,status) VALUES ($1,$2,'submission_received',$3,$4)",
    [args.event, args.contact, args.key, args.status],
  );
}

describe("M46 per-domain deliverability", () => {
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
      "INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES ($1,$5,'a@gmail.com','A','A'), ($2,$5,'b@gmail.com','B','B'), ($3,$5,'c@corp.example','C','C'), ($4,$6,'d@gmail.com','D','D')",
      [gmailA, gmailB, corp, otherEventContact, eventId, otherEventId],
    );

    // gmail.com: 2 sent, 1 bounced, 1 queued (still in flight — excluded from the rate denominator)
    await insertLog(pglite, { event: eventId, contact: gmailA, status: "sent", key: "k1" });
    await insertLog(pglite, { event: eventId, contact: gmailA, status: "sent", key: "k2" });
    await insertLog(pglite, { event: eventId, contact: gmailB, status: "bounced", key: "k3" });
    await insertLog(pglite, { event: eventId, contact: gmailB, status: "queued", key: "k4" });
    // corp.example: 1 sent, 1 complained
    await insertLog(pglite, { event: eventId, contact: corp, status: "sent", key: "k5" });
    await insertLog(pglite, { event: eventId, contact: corp, status: "complained", key: "k6" });
    // a different event's own gmail.com row must never be counted here
    await insertLog(pglite, { event: otherEventId, contact: otherEventContact, status: "sent", key: "k7" });
  }, 30_000);

  afterAll(async () => pglite.close());

  it("groups by recipient email domain and sums every status, scoped to the event", async () => {
    const rows = await getDeliverabilityByDomainIn(tx, eventId);
    expect(rows).toHaveLength(2);
    const gmail = rows.find((row) => row.domain === "gmail.com");
    const corpDomain = rows.find((row) => row.domain === "corp.example");
    expect(gmail).toMatchObject({ total: 4, sent: 2, bounced: 1, queued: 1, complained: 0, failed: 0, skipped: 0 });
    expect(corpDomain).toMatchObject({ total: 2, sent: 1, complained: 1 });
  });

  it("computes rates against settled sends (sent + bounced + complained), excluding queued", async () => {
    const rows = await getDeliverabilityByDomainIn(tx, eventId);
    const gmail = rows.find((row) => row.domain === "gmail.com");
    // settled = 2 sent + 1 bounced = 3; bounce rate = 1/3 = 33.3%
    expect(gmail?.bounceRatePct).toBeCloseTo(33.3, 1);
    expect(gmail?.complaintRatePct).toBe(0);
    const corpDomain = rows.find((row) => row.domain === "corp.example");
    // settled = 1 sent + 1 complained = 2; complaint rate = 50%
    expect(corpDomain?.complaintRatePct).toBe(50);
  });

  it("orders by volume, and never counts another event's rows", async () => {
    const rows = await getDeliverabilityByDomainIn(tx, eventId);
    expect(rows[0]?.domain).toBe("gmail.com"); // 4 > 2
    const totalAcrossDomains = rows.reduce((sum, row) => sum + row.total, 0);
    expect(totalAcrossDomains).toBe(6); // not 7 — the other event's row is excluded
  });

  it("scopes strictly to the event — a second event with one row sees only its own", async () => {
    await expect(getDeliverabilityByDomainIn(tx, otherEventId)).resolves.toMatchObject([{ domain: "gmail.com", total: 1 }]);
  });

  it("returns an empty list for an event with no mail at all", async () => {
    const thirdEventId = eventIdSchema.parse("f2000000-0000-4000-8000-000000000099");
    await pglite.query(
      "INSERT INTO events(id,name,slug,location,timezone,starts_at,ends_at) VALUES ($1,'Empty Event','empty-event','Nowhere','America/Los_Angeles','2026-11-01T16:00:00Z','2026-11-02T01:00:00Z')",
      [thirdEventId],
    );
    await expect(getDeliverabilityByDomainIn(tx, thirdEventId)).resolves.toEqual([]);
  });
});
