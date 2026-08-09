import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import { contactIdSchema, eventIdSchema, idem, submissionIdSchema, tokenIdSchema } from "@/shared/contracts";
import { enqueueEmail } from "@/shared/server/enqueue-email";

const migration0 = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");

let pglite: PGlite;
let tx: TxDb;
const eventId = eventIdSchema.parse("90000000-0000-4000-8000-000000000001");
const contactId = contactIdSchema.parse("90000000-0000-4000-8000-000000000002");
const submissionId = submissionIdSchema.parse("90000000-0000-4000-8000-000000000003");
const tokenId = tokenIdSchema.parse("90000000-0000-4000-8000-000000000004");

describe("enqueueEmail", () => {
  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migration0);
    await pglite.exec(migration1);
    await pglite.query("INSERT INTO events(id,name,slug,starts_at,ends_at) VALUES($1,'Email event','email-event','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')", [eventId]);
    await pglite.query("INSERT INTO contacts(id,event_id,email) VALUES($1,$2,'speaker@example.com')", [contactId, eventId]);
    tx = drizzle(pglite, { schema }) as unknown as TxDb;
  }, 30_000);

  afterAll(async () => {
    await pglite.close();
  });

  it("deduplicates a queued domain email", async () => {
    const idempotencyKey = idem.received(eventId, submissionId);
    const args = { eventId, contactId, templateKey: "submission_received" as const, idempotencyKey };
    await enqueueEmail(tx, args);
    await enqueueEmail(tx, args);
    const result = await pglite.query<{ n: number }>("SELECT count(*)::int AS n FROM communication_logs WHERE idempotency_key=$1 AND status='queued'", [idempotencyKey]);
    expect(result.rows[0]?.n).toBe(1);
  });

  it("requires encrypted portal-login delivery and rejects it for other templates", async () => {
    await expect(enqueueEmail(tx, { eventId, contactId, templateKey: "portal_login", idempotencyKey: idem.portalLogin(eventId, contactId, tokenId) })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(enqueueEmail(tx, { eventId, contactId, templateKey: "submission_received", idempotencyKey: "invalid-secret", secretPayloadCiphertext: new Uint8Array([1]) })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("queues and retains an encrypted portal-login payload", async () => {
    const secretPayloadCiphertext = new Uint8Array([1, 2, 3, 4]);
    const idempotencyKey = idem.portalLogin(eventId, contactId, tokenId);
    await enqueueEmail(tx, { eventId, contactId, templateKey: "portal_login", idempotencyKey, secretPayloadCiphertext });
    const result = await pglite.query<{ status: string; ciphertext: Uint8Array }>("SELECT status,secret_payload_ciphertext AS ciphertext FROM communication_logs WHERE idempotency_key=$1", [idempotencyKey]);
    expect(result.rows[0]?.status).toBe("queued");
    expect(Array.from(result.rows[0]?.ciphertext ?? [])).toEqual([1, 2, 3, 4]);
  });
});
