import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbOrTx, TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import { eventIdSchema, roomIdSchema, sessionIdSchema, userIdSchema } from "@/shared/contracts";
import { moveSessionInTx, saveSessionIn } from "./mutations";
import { listSessionPlacementRevisionsIn, listSessionsIn } from "./queries";

/**
 * MTP-07 §2 steps 12 and 14, against a real Postgres.
 *
 * Two facts the agenda used to lose on every placement write, and both of them
 * are database-shaped rather than component-shaped:
 *
 * 1. A session's expected attendance — the figure Auto-place already weighs
 *    against a room's capacity — never reached the client at all, so no manual
 *    placement could warn about a room that is too small.
 * 2. Moves left no trace. Only title/description edits were recorded, so
 *    "prior placements are recorded with who and when" was untrue of the drag,
 *    of this dialog's own save, and of Auto-place's apply.
 */
const migrations = [
  "0000_init.sql",
  "0006_content_deliverables.sql",
  "0031_agenda_session_creation_receipts.sql",
  "0043_calendar_cancellation_snapshots.sql",
  "0050_session_placement_revisions.sql",
].map((name) => readFileSync(new URL(`../../../../drizzle/${name}`, import.meta.url), "utf8"));

const eventId = eventIdSchema.parse("b1000000-0000-4000-8000-000000000001");
const organizerId = userIdSchema.parse("b1100000-0000-4000-8000-000000000001");
const studioId = roomIdSchema.parse("b1200000-0000-4000-8000-000000000001");
const mainStageId = roomIdSchema.parse("b1200000-0000-4000-8000-000000000002");
const doomedRoomId = roomIdSchema.parse("b1200000-0000-4000-8000-000000000003");
const submissionId = "b1300000-0000-4000-8000-000000000001";
const promotedId = sessionIdSchema.parse("b1400000-0000-4000-8000-000000000001");
const manualId = sessionIdSchema.parse("b1400000-0000-4000-8000-000000000002");
const doomedRoomSessionId = sessionIdSchema.parse("b1400000-0000-4000-8000-000000000003");

describe("session placement awareness", () => {
  let pg: PGlite;
  let database: DbOrTx;

  beforeAll(async () => {
    pg = new PGlite();
    for (const migration of migrations) await pg.exec(migration);
    database = drizzle(pg, { schema }) as unknown as DbOrTx;

    await pg.query(
      `INSERT INTO users(id,email,name) VALUES ($1,'organizer@example.com','Ada Organizer')`,
      [organizerId],
    );
    await pg.query(
      `INSERT INTO events(id,name,slug,timezone,starts_at,ends_at)
       VALUES ($1,'Capacity Conf','capacity-conf','America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')`,
      [eventId],
    );
    await pg.query(
      `INSERT INTO rooms(id,event_id,name,capacity) VALUES ($1,$4,'Studio',60),($2,$4,'Main Stage',1200),($3,$4,'Pop-up Tent',80)`,
      [studioId, mainStageId, doomedRoomId, eventId],
    );
    await pg.query(
      `INSERT INTO submissions(id,event_id,code,status,title,capacity) VALUES ($1,$2,1,'accepted','Vector search at scale',200)`,
      [submissionId, eventId],
    );
    await pg.query(
      `INSERT INTO sessions(id,event_id,submission_id,title,slug,room_id,starts_at,ends_at)
       VALUES ($1,$3,$4,'Vector search at scale','vector-search',$5,'2026-09-16T17:00:00Z','2026-09-16T18:00:00Z'),
              ($2,$3,NULL,'Hallway track','hallway-track',NULL,NULL,NULL)`,
      [promotedId, manualId, eventId, submissionId, studioId],
    );
  }, 60_000);

  afterAll(async () => pg.close());

  it("carries the abstract's expected attendance onto the session it was promoted into", async () => {
    const sessions = await listSessionsIn(database, eventId);
    const byId = new Map(sessions.map((session) => [String(session.id), session]));

    // The one number the product actually stores about audience size, on the
    // session the dialog and the grid hold — no second query, no join for a
    // caller to forget.
    expect(byId.get(String(promotedId))?.expectedAttendance).toBe(200);
    // A manually created session has no abstract behind it, so there is nothing
    // truthful to warn about and the field says so rather than guessing.
    expect(byId.get(String(manualId))?.expectedAttendance).toBeNull();
  });

  it("records a dialog save that changes the room, with who moved it and both room names", async () => {
    const before = await listSessionsIn(database, eventId);
    const session = before.find((row) => String(row.id) === String(promotedId));

    const saved = await saveSessionIn(database, eventId, {
      id: promotedId,
      expectedVersion: session?.rowVersion,
      title: "Vector search at scale",
      descriptionHtml: "",
      formatId: null,
      trackId: null,
      roomId: mainStageId,
      startsAt: "2026-09-16T17:00:00.000Z",
      endsAt: "2026-09-16T18:00:00.000Z",
      speakerContactIds: [],
      status: "draft",
    }, organizerId);

    // The write path also has to hand the expected audience back, or the client
    // cache would forget it the moment the organizer pressed Save. Both facts
    // now come off one lookup of the abstract row (`abstractFactsFor`), so they
    // are asserted together: dropping either one is the way that merge fails.
    expect(saved.expectedAttendance).toBe(200);
    expect(saved.linkedSubmission).toMatchObject({ code: 1, status: "accepted", title: "Vector search at scale" });

    const history = await listSessionPlacementRevisionsIn(database, eventId, promotedId);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      from: { roomName: "Studio", startsAt: "2026-09-16T17:00:00.000Z" },
      to: { roomName: "Main Stage", startsAt: "2026-09-16T17:00:00.000Z" },
      movedByName: "Ada Organizer",
    });
  });

  it("does not record a save that leaves the placement alone", async () => {
    const before = await listSessionsIn(database, eventId);
    const session = before.find((row) => String(row.id) === String(promotedId));

    await saveSessionIn(database, eventId, {
      id: promotedId,
      expectedVersion: session?.rowVersion,
      title: "Vector search at scale, revisited",
      descriptionHtml: "<p>Same room, same time.</p>",
      formatId: null,
      trackId: null,
      roomId: mainStageId,
      startsAt: "2026-09-16T17:00:00.000Z",
      endsAt: "2026-09-16T18:00:00.000Z",
      speakerContactIds: [],
      status: "draft",
    }, organizerId);

    expect(await listSessionPlacementRevisionsIn(database, eventId, promotedId)).toHaveLength(1);
  });

  it("records a drag through moveSession, newest first, and keeps the tray as a readable placement", async () => {
    const before = await listSessionsIn(database, eventId);
    const session = before.find((row) => String(row.id) === String(promotedId));

    await moveSessionInTx(database as TxDb, eventId, {
      id: promotedId,
      version: session?.rowVersion ?? 1,
      startsAt: null,
      endsAt: null,
      roomId: null,
    }, organizerId);

    const history = await listSessionPlacementRevisionsIn(database, eventId, promotedId);
    expect(history).toHaveLength(2);
    // Newest first, and a move back to the tray reads as one rather than as a
    // blank row: this is the same endpoint the grid, Undo and Auto-place use.
    expect(history[0]).toMatchObject({
      from: { roomName: "Main Stage" },
      to: { roomName: null, startsAt: null, endsAt: null },
      movedByName: "Ada Organizer",
    });
    expect(Date.parse(history[0]?.createdAt ?? "")).toBeGreaterThanOrEqual(Date.parse(history[1]?.createdAt ?? ""));
  });

  it("keeps naming a room the history remembers after that room is deleted", async () => {
    await pg.query(
      `INSERT INTO sessions(id,event_id,title,slug,room_id,starts_at,ends_at)
       VALUES ($1,$2,'Pop-up panel','pop-up-panel',$3,'2026-09-16T19:00:00Z','2026-09-16T19:30:00Z')`,
      [doomedRoomSessionId, eventId, doomedRoomId],
    );
    await moveSessionInTx(database as TxDb, eventId, {
      id: doomedRoomSessionId,
      version: 1,
      startsAt: "2026-09-16T20:00:00.000Z",
      endsAt: "2026-09-16T20:30:00.000Z",
      roomId: studioId,
    }, organizerId);

    // `rooms.id` is ON DELETE SET NULL onto sessions, so a room id in the
    // history would have quietly become "no room" — the frozen name is why the
    // account of what happened survives the room that it happened in.
    await pg.query("DELETE FROM rooms WHERE id=$1", [doomedRoomId]);

    const history = await listSessionPlacementRevisionsIn(database, eventId, doomedRoomSessionId);
    expect(history[0]).toMatchObject({ from: { roomName: "Pop-up Tent" }, to: { roomName: "Studio" } });
  });

  it("scopes the history read to its own event", async () => {
    expect(await listSessionPlacementRevisionsIn(
      database,
      eventIdSchema.parse("b1000000-0000-4000-8000-0000000000ff"),
      promotedId,
    )).toEqual([]);
  });
});
