import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbOrTx } from "@/db/client";
import * as schema from "@/db/schema";
import { contactIdSchema, eventIdSchema, sessionIdSchema } from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";
import { createSessionInputSchema, deleteSessionIn, saveSessionIn } from "./mutations";

const migration0 = readFileSync(new URL("../../../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migrationContentRevisions = readFileSync(new URL("../../../../drizzle/0006_content_deliverables.sql", import.meta.url), "utf8");
const migrationCreationReceipts = readFileSync(new URL("../../../../drizzle/0031_agenda_session_creation_receipts.sql", import.meta.url), "utf8");
const migrationCalendarCancellationSnapshots = readFileSync(new URL("../../../../drizzle/0043_calendar_cancellation_snapshots.sql", import.meta.url), "utf8");
const migrationRoomDeletionNotice = readFileSync(new URL("../../../../drizzle/0051_room_deletion_notice.sql", import.meta.url), "utf8");

const eventId = eventIdSchema.parse("a4100000-0000-4000-8000-000000000001");
const otherEventId = eventIdSchema.parse("a4100000-0000-4000-8000-000000000002");
const creationId = sessionIdSchema.parse("a4200000-0000-4000-8000-000000000001");
const distinctCreationId = sessionIdSchema.parse("a4200000-0000-4000-8000-000000000002");
const deletedCreationId = sessionIdSchema.parse("a4200000-0000-4000-8000-000000000003");
const failedCreationId = sessionIdSchema.parse("a4200000-0000-4000-8000-000000000004");
const narrowedBoundsCreationId = sessionIdSchema.parse("a4200000-0000-4000-8000-000000000005");
const firstSpeaker = contactIdSchema.parse("a4300000-0000-4000-8000-000000000001");
const secondSpeaker = contactIdSchema.parse("a4300000-0000-4000-8000-000000000002");

describe("retry-safe manual session creation", () => {
  let pg: PGlite;
  let database: DbOrTx;

  beforeAll(async () => {
    pg = new PGlite();
    await pg.exec(migration0);
    await pg.exec(migrationContentRevisions);
    await pg.exec(migrationCreationReceipts);
    await pg.exec(migrationCalendarCancellationSnapshots);
    await pg.exec(migrationRoomDeletionNotice);
    database = drizzle(pg, { schema }) as unknown as DbOrTx;
    await pg.query(
      `INSERT INTO events(id,name,slug,timezone,starts_at,ends_at) VALUES
       ($1,'Retry Conf','retry-conf','America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z'),
       ($2,'Other Conf','other-conf','America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')`,
      [eventId, otherEventId],
    );
    await pg.query(
      `INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES
       ($1,$3,'ada@example.com','Ada','Lovelace'),
       ($2,$3,'grace@example.com','Grace','Hopper')`,
      [firstSpeaker, secondSpeaker, eventId],
    );
  }, 60_000);

  afterAll(async () => pg.close());

  const input = {
    creationId,
    title: "A Retry-Safe Session",
    descriptionHtml: "<p>Canonical details</p>",
    formatId: null,
    trackId: null,
    roomId: null,
    startsAt: "2026-09-16T17:00:00.000Z",
    endsAt: "2026-09-16T17:30:00.000Z",
    speakerContactIds: [firstSpeaker, secondSpeaker],
    status: "published" as const,
  };

  it("installs the durable receipt tombstone constraints and lookup index", async () => {
    const table = await pg.query<{ name: string | null }>(
      "SELECT to_regclass('session_creation_receipts')::text AS name",
    );
    expect(table.rows[0]?.name).toBe("session_creation_receipts");

    const constraints = await pg.query<{ name: string; type: string; definition: string }>(`
      SELECT conname AS name, contype AS type, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'session_creation_receipts'::regclass
      ORDER BY conname
    `);
    const foreignKeys = constraints.rows.filter((constraint) => constraint.type === "f");
    expect(foreignKeys).toHaveLength(1);
    expect(foreignKeys[0]?.definition).toMatch(/FOREIGN KEY \(event_id\) REFERENCES events\(id\) ON DELETE CASCADE/u);
    expect(constraints.rows.some((constraint) => constraint.definition.includes("REFERENCES sessions"))).toBe(false);
    const fingerprintCheck = constraints.rows.find(
      (constraint) => constraint.name === "session_creation_receipts_payload_fingerprint_ck",
    );
    expect(fingerprintCheck?.definition).toMatch(/^CHECK /u);
    expect(fingerprintCheck?.definition).toContain("btrim(payload_fingerprint) <> ''::text");

    const indexes = await pg.query<{ name: string; definition: string }>(`
      SELECT indexname AS name, indexdef AS definition
      FROM pg_indexes
      WHERE tablename = 'session_creation_receipts'
    `);
    expect(indexes.rows.find((index) => index.name === "session_creation_receipts_event_idx")?.definition)
      .toMatch(/\(event_id\)$/u);
  });

  it("returns one canonical graph and one outbox row per speaker when the same attempt is replayed", async () => {
    expect(createSessionInputSchema.safeParse({ ...input, creationId: undefined }).success).toBe(false);
    expect(createSessionInputSchema.safeParse(input).success).toBe(true);

    const created = await saveSessionIn(database, eventId, input);
    const replayed = await saveSessionIn(database, eventId, input);

    expect(replayed).toEqual(created);
    expect(created).toMatchObject({ id: creationId, slug: "a-retry-safe-session", scheduleRevision: 1 });

    const [sessions, receipts, revisions, speakers, outbox] = await Promise.all([
      pg.query<{ count: number }>("SELECT count(*)::int AS count FROM sessions WHERE id=$1", [creationId]),
      pg.query<{ count: number }>("SELECT count(*)::int AS count FROM session_creation_receipts WHERE creation_id=$1", [creationId]),
      pg.query<{ count: number }>("SELECT count(*)::int AS count FROM session_content_revisions WHERE session_id=$1", [creationId]),
      pg.query<{ count: number }>("SELECT count(*)::int AS count FROM session_speakers WHERE session_id=$1", [creationId]),
      pg.query<{ contact_id: string; count: number }>(
        "SELECT contact_id, count(*)::int AS count FROM communication_logs WHERE session_id=$1 GROUP BY contact_id ORDER BY contact_id",
        [creationId],
      ),
    ]);
    expect(sessions.rows[0]?.count).toBe(1);
    expect(receipts.rows[0]?.count).toBe(1);
    expect(revisions.rows[0]?.count).toBe(1);
    expect(speakers.rows[0]?.count).toBe(2);
    expect(outbox.rows).toEqual([
      { contact_id: firstSpeaker, count: 1 },
      { contact_id: secondSpeaker, count: 1 },
    ]);
  });

  it("keeps distinct same-title attempts legitimate and rejects mismatched or cross-event replays", async () => {
    const distinct = await saveSessionIn(database, eventId, { ...input, creationId: distinctCreationId });
    expect(distinct).toMatchObject({ id: distinctCreationId, slug: "a-retry-safe-session-2" });

    const mismatch = await saveSessionIn(database, eventId, { ...input, title: "Changed after sending" })
      .catch((error: unknown) => error);
    expect(isAppError(mismatch) && mismatch.code).toBe("CONFLICT");

    const crossEvent = await saveSessionIn(database, otherEventId, {
      ...input,
    }).catch((error: unknown) => error);
    expect(isAppError(crossEvent) && crossEvent.code).toBe("CONFLICT");
  });

  it("keeps a deleted creation id consumed so a delayed exact POST cannot resurrect the session", async () => {
    const deletedInput = { ...input, creationId: deletedCreationId, title: "Delete This Session" };
    const created = await saveSessionIn(database, eventId, deletedInput);
    const outboxBeforeDelete = await pg.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM communication_logs WHERE event_id=$1",
      [eventId],
    );

    await deleteSessionIn(database, eventId, created.id, created.rowVersion);
    const replay = await saveSessionIn(database, eventId, deletedInput).catch((error: unknown) => error);
    expect(replay).toMatchObject({
      code: "CONFLICT",
      message: "This creation attempt already completed, but the session was later deleted",
    });

    const [sessionRows, revisions, speakers, receipts, outboxAfterReplay] = await Promise.all([
      pg.query<{ count: number }>("SELECT count(*)::int AS count FROM sessions WHERE id=$1", [deletedCreationId]),
      pg.query<{ count: number }>("SELECT count(*)::int AS count FROM session_content_revisions WHERE session_id=$1", [deletedCreationId]),
      pg.query<{ count: number }>("SELECT count(*)::int AS count FROM session_speakers WHERE session_id=$1", [deletedCreationId]),
      pg.query<{ count: number }>("SELECT count(*)::int AS count FROM session_creation_receipts WHERE creation_id=$1", [deletedCreationId]),
      pg.query<{ count: number }>("SELECT count(*)::int AS count FROM communication_logs WHERE event_id=$1", [eventId]),
    ]);
    expect(sessionRows.rows[0]?.count).toBe(0);
    expect(revisions.rows[0]?.count).toBe(0);
    expect(speakers.rows[0]?.count).toBe(0);
    expect(receipts.rows[0]?.count).toBe(1);
    expect(outboxAfterReplay.rows[0]?.count).toBe(outboxBeforeDelete.rows[0]?.count);
  });

  it("rolls back a receipt with a failed graph insert so the same id can create later", async () => {
    const unknownSpeaker = contactIdSchema.parse("a4300000-0000-4000-8000-000000000099");
    const failed = await saveSessionIn(database, eventId, {
      ...input,
      creationId: failedCreationId,
      title: "Retry After Rollback",
      speakerContactIds: [unknownSpeaker],
    }).catch((error: unknown) => error);
    expect(failed).toBeInstanceOf(Error);
    const afterFailure = await pg.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM session_creation_receipts WHERE creation_id=$1",
      [failedCreationId],
    );
    expect(afterFailure.rows[0]?.count).toBe(0);

    const created = await saveSessionIn(database, eventId, {
      ...input,
      creationId: failedCreationId,
      title: "Retry After Rollback",
      speakerContactIds: [],
    });
    expect(created.id).toBe(failedCreationId);
    const afterSuccess = await pg.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM session_creation_receipts WHERE creation_id=$1",
      [failedCreationId],
    );
    expect(afterSuccess.rows[0]?.count).toBe(1);
  });

  it("recovers a committed create before mutable event bounds can reject its original placement", async () => {
    const narrowedInput = { ...input, creationId: narrowedBoundsCreationId, title: "Recover Before New Bounds" };
    const created = await saveSessionIn(database, eventId, narrowedInput);
    const beforeReplay = await Promise.all([
      pg.query<{ count: number }>("SELECT count(*)::int AS count FROM session_content_revisions WHERE session_id=$1", [narrowedBoundsCreationId]),
      pg.query<{ count: number }>("SELECT count(*)::int AS count FROM session_speakers WHERE session_id=$1", [narrowedBoundsCreationId]),
      pg.query<{ count: number }>("SELECT count(*)::int AS count FROM communication_logs WHERE event_id=$1", [eventId]),
    ]);

    // Product event editing correctly refuses to strand a scheduled session;
    // direct fixture SQL models external/admin repair changing mutable bounds
    // after the create already committed and its HTTP response was lost.
    await pg.query("UPDATE events SET starts_at='2026-09-16T20:00:00Z' WHERE id=$1", [eventId]);
    const replayed = await saveSessionIn(database, eventId, narrowedInput);
    expect(replayed).toEqual(created);

    const afterReplay = await Promise.all([
      pg.query<{ count: number }>("SELECT count(*)::int AS count FROM session_content_revisions WHERE session_id=$1", [narrowedBoundsCreationId]),
      pg.query<{ count: number }>("SELECT count(*)::int AS count FROM session_speakers WHERE session_id=$1", [narrowedBoundsCreationId]),
      pg.query<{ count: number }>("SELECT count(*)::int AS count FROM communication_logs WHERE event_id=$1", [eventId]),
    ]);
    expect(afterReplay.map((result) => result.rows[0]?.count)).toEqual(
      beforeReplay.map((result) => result.rows[0]?.count),
    );
  });
});
