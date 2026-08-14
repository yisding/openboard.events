import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import {
  contactIdSchema,
  eventIdSchema,
  formatIdSchema,
  roomIdSchema,
  sessionIdSchema,
  trackIdSchema,
} from "@/shared/contracts";

function required<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) throw new Error(message);
  return value;
}

const migration0 = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");
const migrationReviewOps = readFileSync(new URL("../../drizzle/0004_review_operations.sql", import.meta.url), "utf8");
const migration6 = readFileSync(new URL("../../drizzle/0006_content_deliverables.sql", import.meta.url), "utf8");
const migrationEmailCompliance = readFileSync(new URL("../../drizzle/0007_email_compliance.sql", import.meta.url), "utf8");
// M51's `contact_unavailability` table — M54's read contract for blackouts.
const migrationSpeakerRoster = readFileSync(new URL("../../drizzle/0008_speaker_roster_operations.sql", import.meta.url), "utf8");
// Manual agenda creates atomically consume their caller-owned id in a durable
// receipt, so this reduced fixture needs the receipt table as well.
const migrationAgendaCreationReceipts = readFileSync(new URL("../../drizzle/0031_agenda_session_creation_receipts.sql", import.meta.url), "utf8");

const eventId = eventIdSchema.parse("a9000000-0000-4000-8000-000000000001");
const ada = contactIdSchema.parse("a9000000-0000-4000-8000-000000000010");
const grace = contactIdSchema.parse("a9000000-0000-4000-8000-000000000011");
const mainStage = roomIdSchema.parse("a9000000-0000-4000-8000-000000000020");
const studio = roomIdSchema.parse("a9000000-0000-4000-8000-000000000021");
const tiny = roomIdSchema.parse("a9000000-0000-4000-8000-000000000022");
const track = trackIdSchema.parse("a9000000-0000-4000-8000-000000000030");
const talkFormat = formatIdSchema.parse("a9000000-0000-4000-8000-000000000040");
const cappedTalk = "a9000000-0000-4000-8000-000000000050";

// The event runs 9am–6pm PT on 2026-09-15 only, so every candidate the
// planner finds is provably inside that one nine-hour window.
const at = (iso: string) => new Date(iso).toISOString();

let pglite: PGlite;
function createTestDb(client: PGlite) {
  return drizzle(client, { schema });
}
let testDb: ReturnType<typeof createTestDb>;

// Same seam as `agenda-sessions.test.ts`: `moveSession` opens a real
// WebSocket pool, so the suite swaps it (and every plain `db` read) for a
// PGlite transaction.
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return {
    ...actual,
    withTx: async (work: (handle: TxDb) => Promise<unknown>) => testDb.transaction(
      async (handle) => work(handle as unknown as TxDb),
    ),
    db: new Proxy({}, { get: (_target, property) => Reflect.get(testDb, property, testDb) }),
  };
});

const { applyPlacements, previewPlacements, saveSession, moveSession } = await import("@/features/agenda");

async function createSession(overrides: Partial<{
  title: string; startsAt: string | null; endsAt: string | null; roomId: string | null;
  trackId: string | null; formatId: string | null; status: "draft" | "published"; speakerContactIds: string[];
}> = {}) {
  return saveSession(eventId, {
    title: "A session",
    descriptionHtml: "",
    formatId: null,
    trackId: null,
    roomId: null,
    startsAt: null,
    endsAt: null,
    speakerContactIds: [],
    status: "draft",
    ...overrides,
  });
}

describe("M54 assisted agenda placement", () => {
  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migration0);
    await pglite.exec(migration1);
    await pglite.exec(migrationReviewOps);
    await pglite.exec(migration6);
    await pglite.exec(migrationEmailCompliance);
    await pglite.exec(migrationSpeakerRoster);
    await pglite.exec(migrationAgendaCreationReceipts);
    testDb = createTestDb(pglite);

    await pglite.query(
      "INSERT INTO events(id,name,slug,timezone,starts_at,ends_at) VALUES($1,'Placement Fest','placement-fest','America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-16T01:00:00Z')",
      [eventId],
    );
    for (const [id, first, last] of [[ada, "Ada", "Lovelace"], [grace, "Grace", "Hopper"]] as const) {
      await pglite.query(
        "INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES($1,$2,$3,$4,$5)",
        [id, eventId, `${first.toLowerCase()}@example.com`, first, last],
      );
    }
    await pglite.query("INSERT INTO rooms(id,event_id,name,capacity,sort_order) VALUES($1,$2,'Main Stage',100,0)", [mainStage, eventId]);
    await pglite.query("INSERT INTO rooms(id,event_id,name,capacity,sort_order) VALUES($1,$2,'Studio',100,1)", [studio, eventId]);
    await pglite.query("INSERT INTO rooms(id,event_id,name,capacity,sort_order) VALUES($1,$2,'Tiny Room',10,2)", [tiny, eventId]);
    await pglite.query("INSERT INTO tracks(id,event_id,name,color,sort_order) VALUES($1,$2,'AI Agents','#6958d7',0)", [track, eventId]);
    await pglite.query(
      "INSERT INTO session_formats(id,event_id,name,default_duration_mins,sort_order) VALUES($1,$2,'Talk',30,0)",
      [talkFormat, eventId],
    );
    await pglite.query(
      "INSERT INTO submissions(id,event_id,code,title,status,capacity,submitted_at) VALUES($1,$2,1,'Capped talk','accepted',500,now())",
      [cappedTalk, eventId],
    );
  }, 60_000);

  beforeEach(async () => {
    await pglite.exec("TRUNCATE sessions, session_speakers, communication_logs, contact_unavailability, session_creation_receipts CASCADE");
  });

  it("previews a deterministic, conflict-free placement and applying it persists day/time/room", async () => {
    const first = await createSession({ title: "First unscheduled", formatId: talkFormat });
    const second = await createSession({ title: "Second unscheduled", formatId: talkFormat });

    const preview1 = await previewPlacements(eventId);
    const preview2 = await previewPlacements(eventId);
    // Re-running on unchanged data produces the same proposal.
    expect(preview2).toEqual(preview1);
    expect(preview1.placed).toHaveLength(2);
    expect(preview1.unplaced).toEqual([]);

    const placedFirst = required(preview1.placed.find((p) => p.sessionId === first.id), "first session was not placed");
    const placedSecond = required(preview1.placed.find((p) => p.sessionId === second.id), "second session was not placed");
    expect(placedFirst).toBeDefined();
    expect(placedSecond).toBeDefined();
    // Two rooms free at the same first slot: chronological room-sort order
    // means the two sessions land in different rooms at the same time,
    // never queued one after another in a single room.
    expect(placedFirst?.startsAt).toBe(placedSecond?.startsAt);
    expect(placedFirst?.roomId).not.toBe(placedSecond?.roomId);

    const applied = await applyPlacements(eventId, [
      { sessionId: first.id, version: placedFirst.version, startsAt: placedFirst.startsAt, endsAt: placedFirst.endsAt, roomId: placedFirst.roomId },
    ]);
    expect(applied.outcomes).toEqual([{
      outcome: "applied", sessionId: first.id,
      session: expect.objectContaining({ id: first.id, startsAt: placedFirst.startsAt, roomId: placedFirst.roomId }),
      conflicts: expect.any(Array),
    }]);

    const row = await pglite.query<{ starts_at: string; room_id: string }>("SELECT starts_at, room_id FROM sessions WHERE id = $1", [first.id]);
    const persisted = required(row.rows[0], "session row missing after apply");
    expect(new Date(persisted.starts_at).toISOString()).toBe(placedFirst.startsAt);
    expect(persisted.room_id).toBe(placedFirst.roomId);
  });

  it("leaves a session unplaced with a useful reason when its only speaker is blacked out for every candidate", async () => {
    const blocked = await createSession({ title: "Blocked speaker", formatId: talkFormat, speakerContactIds: [ada] });
    // Ada is unavailable for the entire event window, so every candidate the
    // planner tries collides with the blackout.
    await pglite.query(
      "INSERT INTO contact_unavailability(event_id, contact_id, starts_at, ends_at, reason) VALUES ($1,$2,'2026-09-15T00:00:00Z','2026-09-17T00:00:00Z','Travel')",
      [eventId, ada],
    );

    const preview = await previewPlacements(eventId);
    expect(preview.placed).toEqual([]);
    expect(preview.unplaced).toEqual([{
      sessionId: blocked.id, title: "Blocked speaker", reason: "no_legal_slot",
      rejections: { roomOrSpeakerConflict: 0, blackout: expect.any(Number), capacity: 0 },
    }]);
    expect(required(preview.unplaced[0], "expected one unplaced row").rejections.blackout).toBeGreaterThan(0);
  });

  it("leaves a capacity-constrained session unplaced when every room is too small", async () => {
    // Only the tiny (capacity 10) room exists for this probe — delete the
    // roomier ones from the search by never referencing them: every room the
    // event actually has is too small for the submission's declared 500.
    const roomy = await pglite.query<{ id: string; capacity: number }>("SELECT id, capacity FROM rooms WHERE event_id = $1 ORDER BY capacity DESC LIMIT 1", [eventId]);
    expect(required(roomy.rows[0], "event has no rooms").capacity).toBeLessThan(500);

    const promoted = await pglite.query<{ id: string }>(
      "INSERT INTO sessions(event_id, submission_id, title, slug, format_id, status) VALUES ($1,$2,'Capped talk','capped-talk',$3,'draft') RETURNING id",
      [eventId, cappedTalk, talkFormat],
    );
    const sessionId = sessionIdSchema.parse(required(promoted.rows[0], "insert returned no row").id);

    const preview = await previewPlacements(eventId);
    const unplaced = preview.unplaced.find((row) => row.sessionId === sessionId);
    expect(unplaced).toBeDefined();
    expect(unplaced?.reason).toBe("no_legal_slot");
    expect(unplaced?.rejections.capacity).toBeGreaterThan(0);
    expect(preview.placed.some((row) => row.sessionId === sessionId)).toBe(false);
  });

  it("never proposes a room double-booking: an occupied room is skipped for the next candidate", async () => {
    const holder = await createSession({
      title: "Holder", roomId: mainStage, status: "published",
      startsAt: at("2026-09-15T16:00:00Z"), endsAt: at("2026-09-15T20:00:00Z"),
    });
    const seeker = await createSession({ title: "Seeker", formatId: talkFormat });
    void holder;

    const preview = await previewPlacements(eventId);
    const placed = preview.placed.find((row) => row.sessionId === seeker.id);
    expect(placed).toBeDefined();
    // Main Stage is occupied until 20:00Z; the seeker must not land there
    // before that, whichever room it actually gets.
    if (placed?.roomId === mainStage) {
      expect(Date.parse(placed.startsAt)).toBeGreaterThanOrEqual(Date.parse("2026-09-15T20:00:00Z"));
    }
  });

  it("apply preflight skips a row whose slot was taken by a concurrent edit since the preview, without discarding the other accepted rows", async () => {
    const a = await createSession({ title: "Row A", formatId: talkFormat });
    const b = await createSession({ title: "Row B", formatId: talkFormat });

    const preview = await previewPlacements(eventId);
    const placedA = required(preview.placed.find((row) => row.sessionId === a.id), "row A was not placed");
    const placedB = required(preview.placed.find((row) => row.sessionId === b.id), "row B was not placed");
    expect(placedA.roomId).not.toBe(placedB.roomId);

    // Somebody else moves a third, brand-new session into row A's exact
    // proposed slot before Apply runs.
    const interloper = await createSession({ title: "Interloper", formatId: talkFormat });
    await moveSession(eventId, { id: interloper.id, version: interloper.rowVersion, startsAt: placedA.startsAt, endsAt: placedA.endsAt, roomId: placedA.roomId });

    const applied = await applyPlacements(eventId, [
      { sessionId: a.id, version: placedA.version, startsAt: placedA.startsAt, endsAt: placedA.endsAt, roomId: placedA.roomId },
      { sessionId: b.id, version: placedB.version, startsAt: placedB.startsAt, endsAt: placedB.endsAt, roomId: placedB.roomId },
    ]);

    const outcomeA = applied.outcomes.find((o) => o.sessionId === a.id);
    const outcomeB = applied.outcomes.find((o) => o.sessionId === b.id);
    expect(outcomeA?.outcome).toBe("skipped");
    // The independent row still applies — one bad row never discards the rest.
    expect(outcomeB?.outcome).toBe("applied");

    const rowA = await pglite.query<{ starts_at: string | null }>("SELECT starts_at FROM sessions WHERE id = $1", [a.id]);
    expect(required(rowA.rows[0], "row A missing").starts_at).toBeNull();
  });

  it("surfaces a stale moveSession CAS failure as its own outcome, distinct from a preflight skip", async () => {
    const a = await createSession({ title: "Stale target", formatId: talkFormat });
    const preview = await previewPlacements(eventId);
    const placedA = required(preview.placed.find((row) => row.sessionId === a.id), "stale target was not placed");

    // The session itself changed (a version bump) after the preview but
    // before Apply, so its own CAS must fail rather than silently overwrite.
    await saveSession(eventId, {
      id: a.id, expectedVersion: a.rowVersion, title: "Renamed before apply",
      descriptionHtml: "", formatId: talkFormat, trackId: null, roomId: null,
      startsAt: null, endsAt: null, speakerContactIds: [], status: "draft",
    });

    const applied = await applyPlacements(eventId, [
      { sessionId: a.id, version: placedA.version, startsAt: placedA.startsAt, endsAt: placedA.endsAt, roomId: placedA.roomId },
    ]);
    expect(applied.outcomes).toEqual([{ outcome: "stale", sessionId: a.id, message: expect.any(String) }]);
  });

  it("does not reimplement conflict detection: applying two accepted rows that both target the same room and time in one batch keeps only the first", async () => {
    const a = await createSession({ title: "Batch A", formatId: talkFormat });
    const b = await createSession({ title: "Batch B", formatId: talkFormat });
    const slot = { startsAt: at("2026-09-15T17:00:00Z"), endsAt: at("2026-09-15T17:30:00Z"), roomId: mainStage };

    const applied = await applyPlacements(eventId, [
      { sessionId: a.id, version: a.rowVersion, ...slot },
      { sessionId: b.id, version: b.rowVersion, ...slot },
    ]);
    const outcomes = new Map(applied.outcomes.map((o) => [o.sessionId, o.outcome]));
    expect(outcomes.get(a.id)).toBe("applied");
    expect(outcomes.get(b.id)).toBe("skipped");
  });
});
