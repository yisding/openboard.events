import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbOrTx, TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import { eventIdSchema, sessionIdSchema, type ScheduledSessionDTO } from "@/shared/contracts";
import { abstractDivergence } from "../lib/abstract-divergence";
import { moveSessionInTx, saveSessionIn } from "./mutations";
import { getSessionIn, listSessionsIn } from "./queries";

const migration0 = readFileSync(new URL("../../../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migrationContentRevisions = readFileSync(new URL("../../../../drizzle/0006_content_deliverables.sql", import.meta.url), "utf8");
const migrationCreationReceipts = readFileSync(new URL("../../../../drizzle/0031_agenda_session_creation_receipts.sql", import.meta.url), "utf8");
const migrationCalendarCancellationSnapshots = readFileSync(new URL("../../../../drizzle/0043_calendar_cancellation_snapshots.sql", import.meta.url), "utf8");
// Both writers exercised below now record a placement revision as part of the
// same statement/transaction, so the table they record into has to exist here
// even though nothing in this file reads it.
const migrationPlacementRevisions = readFileSync(new URL("../../../../drizzle/0050_session_placement_revisions.sql", import.meta.url), "utf8");
const migrationRoomDeletionNotice = readFileSync(new URL("../../../../drizzle/0051_room_deletion_notice.sql", import.meta.url), "utf8");

const eventId = eventIdSchema.parse("b1100000-0000-4000-8000-000000000001");
const promoted = sessionIdSchema.parse("b1200000-0000-4000-8000-000000000001");
const keynote = sessionIdSchema.parse("b1200000-0000-4000-8000-000000000002");
const submissionId = "b1300000-0000-4000-8000-000000000001";

/**
 * MTP-07 §1 steps 4 and 5. A promoted session's public visibility and its title
 * both depend on a row in another table that the agenda never used to read, so
 * a withdrawal or a renamed abstract left the admin showing something the
 * public schedule had already stopped honouring.
 */
describe("a session's link to the abstract it was promoted from", () => {
  let pg: PGlite;
  let database: DbOrTx;

  beforeAll(async () => {
    pg = new PGlite();
    await pg.exec(migration0);
    await pg.exec(migrationContentRevisions);
    await pg.exec(migrationCreationReceipts);
    await pg.exec(migrationCalendarCancellationSnapshots);
    await pg.exec(migrationPlacementRevisions);
    await pg.exec(migrationRoomDeletionNotice);
    database = drizzle(pg, { schema }) as unknown as DbOrTx;
    await pg.query(
      `INSERT INTO events(id,name,slug,timezone,starts_at,ends_at)
       VALUES ($1,'Link Conf','link-conf','America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')`,
      [eventId],
    );
    await pg.query(
      `INSERT INTO submissions(id,event_id,code,status,title) VALUES ($1,$2,12,'accepted','Reliable agents')`,
      [submissionId, eventId],
    );
    await pg.query(
      `INSERT INTO sessions(id,event_id,submission_id,title,slug,starts_at,ends_at,status) VALUES
        ($1,$3,$4,'Reliable agents','reliable-agents','2026-09-15T17:00:00Z','2026-09-15T17:30:00Z','published'),
        ($2,$3,NULL,'Opening keynote','opening-keynote','2026-09-15T16:10:00Z','2026-09-15T16:40:00Z','published')`,
      [promoted, keynote, eventId, submissionId],
    );
  }, 60_000);

  afterAll(async () => {
    await pg.close();
  });

  /** The agenda's own read, or a failure that names what was missing. */
  async function read(sessionId: typeof promoted): Promise<ScheduledSessionDTO> {
    const row = await getSessionIn(database, eventId, sessionId);
    if (!row) throw new Error(`No session ${sessionId}`);
    return row;
  }

  it("carries the abstract's live status and title, and nothing for an agenda-authored session", async () => {
    const sessions = await listSessionsIn(database, eventId);
    const byId = new Map(sessions.map((session) => [String(session.id), session]));
    expect(byId.get(promoted)?.linkedSubmission).toEqual({
      id: submissionId,
      code: 12,
      title: "Reliable agents",
      status: "accepted",
    });
    expect(byId.get(keynote)?.linkedSubmission).toBeNull();
    expect(abstractDivergence(await read(promoted))).toBeNull();
  });

  it("shows a published session as no longer public once its abstract is withdrawn", async () => {
    await pg.query("UPDATE submissions SET status='withdrawn' WHERE id=$1", [submissionId]);
    const session = await read(promoted);
    expect(session.linkedSubmission?.status).toBe("withdrawn");
    expect(abstractDivergence(session)).toEqual({ kind: "hidden", abstractStatus: "withdrawn" });

    // The keynote is not promoted from anything, so nothing about it changed.
    expect(abstractDivergence(await read(keynote))).toBeNull();
  });

  it("shows the drift when the abstract is renamed after promotion", async () => {
    await pg.query("UPDATE submissions SET status='accepted', title='Reliable agents, revisited' WHERE id=$1", [submissionId]);
    const session = await read(promoted);
    expect(session.title).toBe("Reliable agents");
    expect(abstractDivergence(session)).toEqual({
      kind: "title_drift",
      abstractTitle: "Reliable agents, revisited",
    });
  });

  it("keeps the link on the row a save returns, so the mark survives an edit", async () => {
    const before = await read(promoted);
    const saved = await saveSessionIn(database, eventId, {
      id: promoted,
      expectedVersion: before.rowVersion,
      title: "Reliable agents",
      descriptionHtml: "<p>Still the promoted talk.</p>",
      formatId: null,
      trackId: null,
      roomId: null,
      startsAt: "2026-09-15T17:00:00.000Z",
      endsAt: "2026-09-15T17:30:00.000Z",
      speakerContactIds: [],
      status: "published",
    });
    expect(saved.linkedSubmission).toMatchObject({ title: "Reliable agents, revisited", status: "accepted" });
    expect(abstractDivergence(saved)).toMatchObject({ kind: "title_drift" });
  });

  // A drag is the one write whose response is written straight into the
  // TanStack cache (`acceptServerMove` replaces the whole row), and
  // `linkedSubmission` parses `.default(null)` — so an omission here would
  // erase the mark silently rather than throw.
  it("keeps the link on the row a drag returns", async () => {
    const before = await read(promoted);
    const { session } = await moveSessionInTx(database as unknown as TxDb, eventId, {
      id: promoted,
      version: before.rowVersion,
      startsAt: "2026-09-15T18:00:00.000Z",
      endsAt: "2026-09-15T18:30:00.000Z",
      roomId: null,
    });
    expect(session.linkedSubmission).toMatchObject({ title: "Reliable agents, revisited", status: "accepted" });
    expect(abstractDivergence(session)).toMatchObject({ kind: "title_drift" });
  });
});
