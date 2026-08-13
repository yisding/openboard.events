import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbOrTx, TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import { issuePortalToken, openPortalLoginPayload } from "@/features/auth";
import { verifyPortalTokenIn } from "@/features/auth/server/tokens";
import { contactIdSchema, eventIdSchema, tokenIdSchema } from "@/shared/contracts";
import { inviteSpeakerToPortalIn } from "./_lib";

const migration0 = readFileSync(new URL("../../../../../../../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migrationRoster = readFileSync(new URL("../../../../../../../../drizzle/0008_speaker_roster_operations.sql", import.meta.url), "utf8");
const migrationSpeakerMoments = readFileSync(new URL("../../../../../../../../drizzle/0016_speaker_moments.sql", import.meta.url), "utf8");

const eventId = eventIdSchema.parse("d1000000-0000-4000-8000-000000000001");
const contactId = contactIdSchema.parse("d2000000-0000-4000-8000-000000000001");
const sessionSecret = "atomic-speaker-invite-test-secret";

describe("atomic speaker portal invitation", () => {
  let pg: PGlite;

  beforeAll(async () => {
    pg = new PGlite();
    await pg.exec(migration0);
    await pg.exec(migrationRoster);
    await pg.exec(migrationSpeakerMoments);
    await pg.query(
      `INSERT INTO events(id,name,slug,timezone,starts_at,ends_at)
       VALUES ($1,'Invite Conf','invite-conf','America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')`,
      [eventId],
    );
    await pg.query(
      `INSERT INTO contacts(id,event_id,email,first_name,last_name)
       VALUES ($1,$2,'speaker@example.com','Ada','Lovelace')`,
      [contactId, eventId],
    );
  }, 60_000);

  afterAll(async () => pg.close());

  it("rolls back token rotation, queued mail, and status together, then commits one usable invite on retry", async () => {
    const database = drizzle(pg, { schema });
    const dbOrTx = database as unknown as DbOrTx;
    const prior = await issuePortalToken(dbOrTx, {
      eventId,
      contactId,
      purpose: "magic_link",
      ttl: "PT15M",
      withOtp: true,
    });

    await pg.exec(`
      CREATE FUNCTION fail_invited_status() RETURNS trigger AS $$
      BEGIN
        IF NEW.workflow_status = 'invited' AND OLD.workflow_status IS DISTINCT FROM NEW.workflow_status THEN
          RAISE EXCEPTION 'forced invited-status failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_invited_status
      BEFORE UPDATE ON contacts
      FOR EACH ROW EXECUTE FUNCTION fail_invited_status();
    `);

    const invite = (tx: TxDb) => inviteSpeakerToPortalIn(tx, {
      eventId,
      eventSlug: "invite-conf",
      contactId,
      email: "speaker@example.com",
      confirmationStatus: "unconfirmed",
      appBaseUrl: "http://localhost:3000",
      sessionSecret,
      fallback: true,
    });

    await expect(database.transaction((tx) => invite(tx as unknown as TxDb))).rejects.toThrow();

    const tokensAfterFailure = await pg.query<{ total: number; active: number }>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE consumed_at IS NULL)::int AS active
       FROM portal_tokens WHERE event_id=$1 AND contact_id=$2`,
      [eventId, contactId],
    );
    const mailAfterFailure = await pg.query<{ total: number; queued_outbox: number }>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status='queued')::int AS queued_outbox
       FROM communication_logs WHERE event_id=$1 AND contact_id=$2`,
      [eventId, contactId],
    );
    const statusAfterFailure = await pg.query<{ workflow_status: string }>(
      "SELECT workflow_status FROM contacts WHERE event_id=$1 AND id=$2",
      [eventId, contactId],
    );
    expect(tokensAfterFailure.rows[0]).toEqual({ total: 1, active: 1 });
    expect(await verifyPortalTokenIn(dbOrTx, prior.raw, { purpose: "magic_link" })).toEqual({ contactId, eventId });
    // `communication_logs` is also the durable speaker-email outbox; both
    // views of that single row must remain absent after the rollback.
    expect(mailAfterFailure.rows[0]).toEqual({ total: 0, queued_outbox: 0 });
    expect(statusAfterFailure.rows[0]?.workflow_status).toBe("new");

    await pg.exec("DROP TRIGGER fail_invited_status ON contacts; DROP FUNCTION fail_invited_status();");
    const result = await database.transaction((tx) => invite(tx as unknown as TxDb));
    expect(result.fallback).toBeDefined();

    const tokensAfterRetry = await pg.query<{ id: string; consumed_at: Date | null }>(
      `SELECT id,consumed_at FROM portal_tokens
       WHERE event_id=$1 AND contact_id=$2 ORDER BY created_at,id`,
      [eventId, contactId],
    );
    const activeToken = tokensAfterRetry.rows.find((row) => row.consumed_at === null);
    const committedMail = await database.select({
      idempotencyKey: schema.communicationLogs.idempotencyKey,
      status: schema.communicationLogs.status,
      secretPayloadCiphertext: schema.communicationLogs.secretPayloadCiphertext,
    }).from(schema.communicationLogs);
    const committedStatus = await pg.query<{ workflow_status: string }>(
      "SELECT workflow_status FROM contacts WHERE event_id=$1 AND id=$2",
      [eventId, contactId],
    );

    expect(tokensAfterRetry.rows).toHaveLength(2);
    expect(tokensAfterRetry.rows.filter((row) => row.consumed_at === null)).toHaveLength(1);
    expect(await verifyPortalTokenIn(dbOrTx, prior.raw, { purpose: "magic_link" })).toBeNull();
    expect(committedMail).toHaveLength(1);
    expect(committedMail[0]?.status).toBe("queued");
    expect(committedStatus.rows[0]?.workflow_status).toBe("invited");
    expect(activeToken).toBeDefined();
    expect(committedMail[0]?.secretPayloadCiphertext).toBeInstanceOf(Uint8Array);
    if (!activeToken || !committedMail[0]?.secretPayloadCiphertext) throw new Error("expected one queued credential-bearing invite");
    const payload = await openPortalLoginPayload(
      committedMail[0].secretPayloadCiphertext,
      { eventId, contactId, tokenId: tokenIdSchema.parse(activeToken.id) },
      sessionSecret,
    );
    const deliveredRaw = new URL(payload.magicLink).searchParams.get("token");
    expect(deliveredRaw).not.toBeNull();
    expect(await verifyPortalTokenIn(dbOrTx, deliveredRaw ?? "", { purpose: "magic_link" })).toEqual({ contactId, eventId });
  }, 60_000);
});
