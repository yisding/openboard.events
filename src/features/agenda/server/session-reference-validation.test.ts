import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbOrTx } from "@/db/client";
import * as schema from "@/db/schema";
import { contactIdSchema, eventIdSchema, roomIdSchema, sessionIdSchema, trackIdSchema } from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";
import { saveSessionIn } from "./mutations";

const migration0 = readFileSync(new URL("../../../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migrationContentRevisions = readFileSync(new URL("../../../../drizzle/0006_content_deliverables.sql", import.meta.url), "utf8");
const migrationCreationReceipts = readFileSync(new URL("../../../../drizzle/0031_agenda_session_creation_receipts.sql", import.meta.url), "utf8");
const migrationCalendarCancellationSnapshots = readFileSync(new URL("../../../../drizzle/0043_calendar_cancellation_snapshots.sql", import.meta.url), "utf8");

const eventId = eventIdSchema.parse("b4100000-0000-4000-8000-000000000001");
const otherEventId = eventIdSchema.parse("b4100000-0000-4000-8000-000000000002");
// A room that exists, but in the *other* event: the composite (id, event_id) FK
// is the tenancy boundary, so this is a foreign reference, not a dangling one.
const foreignRoomId = roomIdSchema.parse("b4200000-0000-4000-8000-000000000001");
// An id that matches nothing at all.
const danglingTrackId = trackIdSchema.parse("b4300000-0000-4000-8000-000000000009");
const speaker = contactIdSchema.parse("b4400000-0000-4000-8000-000000000001");

/** The first field error, unwrapped for a compact assertion. */
async function refusal(run: () => Promise<unknown>): Promise<{ code: string; fieldErrors: Record<string, string> | undefined }> {
  try {
    await run();
  } catch (error) {
    if (isAppError(error)) return { code: error.code, fieldErrors: error.fieldErrors };
    throw error;
  }
  throw new Error("expected the create to be refused");
}

describe("a foreign or dangling reference on session create", () => {
  let pg: PGlite;
  let database: DbOrTx;

  beforeAll(async () => {
    pg = new PGlite();
    await pg.exec(migration0);
    await pg.exec(migrationContentRevisions);
    await pg.exec(migrationCreationReceipts);
    await pg.exec(migrationCalendarCancellationSnapshots);
    database = drizzle(pg, { schema }) as unknown as DbOrTx;
    await pg.query(
      `INSERT INTO events(id,name,slug,timezone,starts_at,ends_at) VALUES
       ($1,'Ref Conf','ref-conf','America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z'),
       ($2,'Other Conf','other-conf','America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')`,
      [eventId, otherEventId],
    );
    await pg.query("INSERT INTO rooms(id,event_id,name) VALUES ($1,$2,'Hall A')", [foreignRoomId, otherEventId]);
    await pg.query("INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES ($1,$2,'ada@example.com','Ada','Lovelace')", [speaker, eventId]);
  }, 60_000);

  afterAll(async () => pg.close());

  const base = {
    creationId: sessionIdSchema.parse("b4500000-0000-4000-8000-000000000001"),
    title: "Keynote",
    descriptionHtml: "<p>Details</p>",
    startsAt: null,
    endsAt: null,
    speakerContactIds: [] as string[],
    status: "draft" as const,
  };

  it("answers a room from another event as a field-scoped VALIDATION, and writes nothing", async () => {
    const outcome = await refusal(() => saveSessionIn(database, eventId, { ...base, roomId: foreignRoomId }));

    expect(outcome.code).toBe("VALIDATION");
    expect(outcome.fieldErrors).toMatchObject({ roomId: expect.any(String) });

    const rows = await pg.query<{ count: number }>("SELECT count(*)::int AS count FROM sessions WHERE event_id=$1", [eventId]);
    expect(rows.rows[0]?.count).toBe(0);
    // The composite FK rejected the insert; the caller-owned id must stay free.
    const receipts = await pg.query<{ count: number }>("SELECT count(*)::int AS count FROM session_creation_receipts WHERE creation_id=$1", [base.creationId]);
    expect(receipts.rows[0]?.count).toBe(0);
  });

  it("answers a dangling track id the same way", async () => {
    const outcome = await refusal(() =>
      saveSessionIn(database, eventId, {
        ...base,
        creationId: sessionIdSchema.parse("b4500000-0000-4000-8000-000000000002"),
        trackId: danglingTrackId,
      }),
    );

    expect(outcome.code).toBe("VALIDATION");
    expect(outcome.fieldErrors).toMatchObject({ trackId: expect.any(String) });
  });
});
