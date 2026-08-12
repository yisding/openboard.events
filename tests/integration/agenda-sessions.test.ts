import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import {
  contactIdSchema,
  eventIdSchema,
  idem,
  roomIdSchema,
  sessionIdSchema,
  submissionIdSchema,
  trackIdSchema,
  userIdSchema,
  type UserId,
} from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";

const migration0 = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");
// M50 is additive on top of the base schema; applying it keeps this fixture
// aligned with the columns the repository modules now read.
const migrationReviewOps = readFileSync(new URL("../../drizzle/0004_review_operations.sql", import.meta.url), "utf8");
// M52's content-revisions table. Independent of 0002–0005 (auth/review/rate-limit).
const migration6 = readFileSync(new URL("../../drizzle/0006_content_deliverables.sql", import.meta.url), "utf8");
// P3-EMAIL added columns to the Drizzle `contacts` schema; any bare
// `db.update(contacts)....returning()` (Drizzle selects every mapped column)
// now needs them to exist, even in a suite that never exercises suppression.
const migrationEmailCompliance = readFileSync(new URL("../../drizzle/0007_email_compliance.sql", import.meta.url), "utf8");

const eventId = eventIdSchema.parse("a8000000-0000-4000-8000-000000000001");
const otherEventId = eventIdSchema.parse("a8000000-0000-4000-8000-000000000002");
const ada = contactIdSchema.parse("a8000000-0000-4000-8000-000000000010");
const grace = contactIdSchema.parse("a8000000-0000-4000-8000-000000000011");
const alan = contactIdSchema.parse("a8000000-0000-4000-8000-000000000012");
const mainStage = roomIdSchema.parse("a8000000-0000-4000-8000-000000000020");
const studio = roomIdSchema.parse("a8000000-0000-4000-8000-000000000021");
const agentsTrack = trackIdSchema.parse("a8000000-0000-4000-8000-000000000030");
const acceptedTalk = submissionIdSchema.parse("a8000000-0000-4000-8000-000000000040");
const pendingTalk = submissionIdSchema.parse("a8000000-0000-4000-8000-000000000041");
const organizer = userIdSchema.parse("a8000000-0000-4000-8000-000000000050");

// The event runs 9am–6pm PT on 2026-09-15/16. Times below are written as UTC
// instants for the fixture's benefit; the day-key assertions are what prove the
// zone conversion, and 2026-09-15T16:00:00Z is 9am PT.
const DAY_ONE = "2026-09-15";
const at = (iso: string) => new Date(iso).toISOString();

let pglite: PGlite;
function createTestDb(client: PGlite) {
  return drizzle(client, { schema });
}
let testDb: ReturnType<typeof createTestDb>;

// `moveSession` opens a real WebSocket pool against Neon. The seam under test is
// its body, so the suite runs it inside a real PGlite transaction instead.
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

const {
  bulkSetPublished, deleteSession, detectConflicts, getMySessions, getSchedulableSessions,
  listAgendaVocabulary, listSessionContentRevisions, listSessions, moveSession, promoteSubmission,
  restoreSessionContent, saveSession,
} = await import("@/features/agenda");
// The promotion picker is M18's read; the tray consumes it unchanged.
const { getAcceptedForScheduling } = await import("@/features/submissions");

async function count(table: string, where = "TRUE"): Promise<number> {
  const result = await pglite.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`);
  return result.rows[0]?.n ?? 0;
}

async function createSession(overrides: Partial<{
  title: string; startsAt: string | null; endsAt: string | null; roomId: string | null;
  trackId: string | null; status: "draft" | "published"; speakerContactIds: string[];
}> = {}, actorUserId: UserId | null = null) {
  return saveSession(eventId, {
    title: "A session",
    descriptionHtml: "<p>Hello</p>",
    formatId: null,
    trackId: null,
    roomId: null,
    startsAt: null,
    endsAt: null,
    speakerContactIds: [],
    status: "draft",
    ...overrides,
  }, actorUserId);
}

describe("agenda sessions", () => {
  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migration0);
    await pglite.exec(migration1);
    await pglite.exec(migrationReviewOps);
    await pglite.exec(migration6);
    await pglite.exec(migrationEmailCompliance);
    testDb = createTestDb(pglite);

    await pglite.query(
      "INSERT INTO users(id,email,name) VALUES($1,'maya@example.com','Maya Lin')",
      [organizer],
    );
    for (const [id, slug] of [[eventId, "agenda-event"], [otherEventId, "other-event"]] as const) {
      await pglite.query(
        "INSERT INTO events(id,name,slug,timezone,starts_at,ends_at) VALUES($1,$2,$3,'America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
        [id, slug, slug],
      );
    }
    for (const [id, first, last] of [[ada, "Ada", "Lovelace"], [grace, "Grace", "Hopper"], [alan, "Alan", "Turing"]] as const) {
      await pglite.query(
        "INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES($1,$2,$3,$4,$5)",
        [id, eventId, `${first.toLowerCase()}@example.com`, first, last],
      );
    }
    for (const [id, name] of [[mainStage, "Main Stage"], [studio, "Studio"]] as const) {
      await pglite.query("INSERT INTO rooms(id,event_id,name,capacity,sort_order) VALUES($1,$2,$3,100,0)", [id, eventId, name]);
    }
    await pglite.query("INSERT INTO tracks(id,event_id,name,color,sort_order) VALUES($1,$2,'AI Agents','#6958d7',0)", [agentsTrack, eventId]);

    await pglite.query(
      "INSERT INTO submissions(id,event_id,code,title,description_html,track_id,status,submitted_at) VALUES($1,$2,1,'Caching at the edge','<p>Fast</p>',$3,'accepted', now())",
      [acceptedTalk, eventId, agentsTrack],
    );
    await pglite.query(
      "INSERT INTO submission_participants(event_id,submission_id,contact_id,is_primary,sort_order) VALUES($1,$2,$3,true,0)",
      [eventId, acceptedTalk, ada],
    );
    await pglite.query(
      "INSERT INTO submission_participants(event_id,submission_id,contact_id,is_primary,sort_order) VALUES($1,$2,$3,false,1)",
      [eventId, acceptedTalk, grace],
    );
    await pglite.query(
      "INSERT INTO submissions(id,event_id,code,title,status,submitted_at) VALUES($1,$2,2,'Undecided','pending', now())",
      [pendingTalk, eventId],
    );
  }, 60_000);

  beforeEach(async () => {
    await pglite.exec("TRUNCATE sessions, session_speakers, communication_logs, session_content_revisions CASCADE");
  });

  it("creates a session with its speakers in one round trip, and lists it back", async () => {
    const created = await createSession({ title: "Opening keynote", speakerContactIds: [ada, grace] });
    expect(created.rowVersion).toBe(1);
    expect(created.speakerIds).toEqual([ada, grace]);

    const rows = await listSessions(eventId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe("Opening keynote");
    expect(rows[0]?.startsAt).toBeNull();
    expect(await count("session_speakers")).toBe(2);
  });

  it("sanitizes description HTML on create and on update", async () => {
    const created = await createSession({ title: "XSS probe" });
    await pglite.query("UPDATE sessions SET description_html = $1", ["<p>x</p>"]);
    const updated = await saveSession(eventId, {
      id: created.id,
      expectedVersion: created.rowVersion,
      title: "XSS probe",
      descriptionHtml: '<p>Before <img src=x onerror=alert(1)><script>alert(2)</script> after</p>',
      formatId: null, trackId: null, roomId: null, startsAt: null, endsAt: null,
      speakerContactIds: [], status: "draft",
    });
    expect(updated.descriptionHtml).not.toContain("onerror");
    expect(updated.descriptionHtml).not.toContain("<script");
  });

  it("M52: records an attributed content revision on create and on each content edit", async () => {
    const created = await createSession({ title: "Keynote v1" }, organizer);
    const firstHistory = await listSessionContentRevisions(eventId, created.id);
    expect(firstHistory).toHaveLength(1);
    expect(firstHistory[0]?.title).toBe("Keynote v1");
    expect(firstHistory[0]?.editedByName).toBe("Maya Lin");
    expect(firstHistory[0]?.restoredFromRevisionId).toBeNull();

    const updated = await saveSession(eventId, {
      id: created.id, expectedVersion: created.rowVersion, title: "Keynote v2",
      descriptionHtml: "<p>v2</p>", formatId: null, trackId: null, roomId: null,
      startsAt: null, endsAt: null, speakerContactIds: [], status: "draft",
    }, organizer);

    const history = await listSessionContentRevisions(eventId, updated.id);
    // Newest first.
    expect(history.map((entry) => entry.title)).toEqual(["Keynote v2", "Keynote v1"]);
  });

  it("M52: a schedule-only save does not add a content revision", async () => {
    const created = await createSession({ title: "Stable title", roomId: null });
    await saveSession(eventId, {
      id: created.id, expectedVersion: created.rowVersion, title: "Stable title",
      descriptionHtml: "<p>Hello</p>", formatId: null, trackId: null, roomId: mainStage,
      startsAt: at("2026-09-15T17:00:00Z"), endsAt: at("2026-09-15T17:30:00Z"),
      speakerContactIds: [], status: "draft",
    });
    const history = await listSessionContentRevisions(eventId, created.id);
    // Just the one revision from creation — the room/time-only save added none.
    expect(history).toHaveLength(1);
  });

  it("M52: restores an earlier revision as a new revision, preserving publish status", async () => {
    const created = await createSession({
      title: "Original title", status: "published",
      startsAt: at("2026-09-15T17:00:00Z"), endsAt: at("2026-09-15T17:30:00Z"),
    }, organizer);
    const edited = await saveSession(eventId, {
      id: created.id, expectedVersion: created.rowVersion, title: "Edited title",
      descriptionHtml: "<p>Edited</p>", formatId: null, trackId: null, roomId: null,
      startsAt: created.startsAt, endsAt: created.endsAt, speakerContactIds: [], status: "published",
    });
    const history = await listSessionContentRevisions(eventId, edited.id);
    expect(history).toHaveLength(2);
    const originalRevisionId = history[1]?.id;
    expect(history[1]?.title).toBe("Original title");
    if (!originalRevisionId) throw new Error("expected an original revision to restore from");

    const restored = await restoreSessionContent(eventId, edited.id, originalRevisionId, organizer);
    expect(restored.title).toBe("Original title");
    expect(restored.descriptionHtml).toBe("<p>Hello</p>");
    // Publication is untouched by a content restore (the module's own
    // draft/published gate guardrail) — still published, no leaked draft.
    expect(restored.status).toBe("published");

    const finalHistory = await listSessionContentRevisions(eventId, edited.id);
    expect(finalHistory).toHaveLength(3);
    expect(finalHistory[0]?.title).toBe("Original title");
    expect(finalHistory[0]?.restoredFromRevisionId).toBe(originalRevisionId);
    expect(finalHistory[0]?.editedByName).toBe("Maya Lin");
  });

  it("collapses a duplicated speaker id into one row", async () => {
    const created = await createSession({ title: "Deduped", speakerContactIds: [ada, ada, grace, ada] });
    expect(created.speakerIds).toEqual([ada, grace]);
    expect(await count("session_speakers")).toBe(2);
  });

  it("replaces the speaker set atomically, keeping the ones that stayed", async () => {
    const created = await createSession({ title: "Panel", speakerContactIds: [ada, grace] });
    const updated = await saveSession(eventId, {
      id: created.id, expectedVersion: created.rowVersion,
      title: "Panel", descriptionHtml: "", formatId: null, trackId: null, roomId: null,
      startsAt: null, endsAt: null,
      // Ada stays (so the upsert half is exercised), Grace leaves, Alan joins.
      speakerContactIds: [ada, alan], status: "draft",
    });
    expect(updated.speakerIds).toEqual([ada, alan]);
    const rows = await pglite.query<{ contact_id: string; sort_order: number; role: string }>(
      "SELECT contact_id, sort_order, role FROM session_speakers ORDER BY sort_order",
    );
    expect(rows.rows.map((row) => row.contact_id)).toEqual([ada, alan]);
    expect(rows.rows.map((row) => row.role)).toEqual(["speaker", "co_speaker"]);
  });

  it("rejects a stale row_version on update with STALE_WRITE", async () => {
    const created = await createSession({ title: "Contested" });
    await saveSession(eventId, {
      id: created.id, expectedVersion: created.rowVersion, title: "First writer wins",
      descriptionHtml: "", formatId: null, trackId: null, roomId: null,
      startsAt: null, endsAt: null, speakerContactIds: [], status: "draft",
    });
    await expect(saveSession(eventId, {
      id: created.id, expectedVersion: created.rowVersion, title: "Second writer",
      descriptionHtml: "", formatId: null, trackId: null, roomId: null,
      startsAt: null, endsAt: null, speakerContactIds: [], status: "draft",
    })).rejects.toMatchObject({ code: "STALE_WRITE" });
    const titles = await pglite.query<{ title: string }>("SELECT title FROM sessions");
    expect(titles.rows[0]?.title).toBe("First writer wins");
  });

  it("publishing a draft with times set enqueues schedule_assigned for each speaker", async () => {
    const created = await createSession({ title: "To be published", speakerContactIds: [ada, grace] });
    const published = await saveSession(eventId, {
      id: created.id, expectedVersion: created.rowVersion, title: "To be published",
      descriptionHtml: "", formatId: null, trackId: null, roomId: mainStage,
      startsAt: at("2026-09-15T17:00:00Z"), endsAt: at("2026-09-15T17:30:00Z"),
      speakerContactIds: [ada, grace], status: "published",
    });
    // The stored status was still 'draft' when the CASE ran; a bump keyed on the
    // old column would have missed this and swallowed both emails.
    expect(published.scheduleRevision).toBe(1);
    const logs = await pglite.query<{ template_key: string; contact_id: string; idempotency_key: string }>(
      "SELECT template_key, contact_id, idempotency_key FROM communication_logs ORDER BY contact_id",
    );
    expect(logs.rows).toHaveLength(2);
    expect(logs.rows.every((row) => row.template_key === "schedule_assigned")).toBe(true);
    expect(logs.rows.map((row) => row.idempotency_key)).toContain(idem.scheduled(eventId, published.id, ada, 1));
  });

  it("tells a speaker added to an already-published session, and only that speaker", async () => {
    const created = await createSession({ title: "Standing keynote", speakerContactIds: [ada] });
    const published = await saveSession(eventId, {
      id: created.id, expectedVersion: created.rowVersion, title: "Standing keynote",
      descriptionHtml: "", formatId: null, trackId: null, roomId: mainStage,
      startsAt: at("2026-09-15T17:00:00Z"), endsAt: at("2026-09-15T17:30:00Z"),
      speakerContactIds: [ada], status: "published",
    });
    await pglite.exec("TRUNCATE communication_logs");

    // Everything about the schedule is byte-identical; only the speaker set grew.
    // `schedule_revision` deliberately stays put — M35's ICS SEQUENCE hangs off it
    // — so grace's notice cannot be gated on a bump.
    const withGrace = await saveSession(eventId, {
      id: published.id, expectedVersion: published.rowVersion, title: "Standing keynote",
      descriptionHtml: "", formatId: null, trackId: null, roomId: mainStage,
      startsAt: at("2026-09-15T17:00:00Z"), endsAt: at("2026-09-15T17:30:00Z"),
      speakerContactIds: [ada, grace], status: "published",
    });
    expect(withGrace.scheduleRevision).toBe(published.scheduleRevision);

    const logs = await pglite.query<{ template_key: string; contact_id: string; idempotency_key: string }>(
      "SELECT template_key, contact_id, idempotency_key FROM communication_logs",
    );
    expect(logs.rows).toEqual([{
      template_key: "schedule_assigned",
      contact_id: grace,
      idempotency_key: idem.scheduled(eventId, published.id, grace, withGrace.scheduleRevision),
    }]);
  });

  it("does not mail a speaker added to a draft or an unscheduled session", async () => {
    const draft = await createSession({
      title: "Still a draft", roomId: mainStage, speakerContactIds: [ada],
      startsAt: at("2026-09-15T17:00:00Z"), endsAt: at("2026-09-15T17:30:00Z"),
    });
    await saveSession(eventId, {
      id: draft.id, expectedVersion: draft.rowVersion, title: "Still a draft",
      descriptionHtml: "", formatId: null, trackId: null, roomId: mainStage,
      startsAt: at("2026-09-15T17:00:00Z"), endsAt: at("2026-09-15T17:30:00Z"),
      speakerContactIds: [ada, grace], status: "draft",
    });

    const untimed = await createSession({ title: "Published but unplaced", speakerContactIds: [ada], status: "published" });
    await saveSession(eventId, {
      id: untimed.id, expectedVersion: untimed.rowVersion, title: "Published but unplaced",
      descriptionHtml: "", formatId: null, trackId: null, roomId: null,
      startsAt: null, endsAt: null, speakerContactIds: [ada, grace], status: "published",
    });

    expect(await count("communication_logs")).toBe(0);
  });

  it("rejects a half-set time pair before it reaches the CHECK constraint", async () => {
    await expect(createSession({ title: "Half timed", startsAt: at("2026-09-15T17:00:00Z"), endsAt: null }))
      .rejects.toBeDefined();
    await expect(createSession({
      title: "Backwards", startsAt: at("2026-09-15T18:00:00Z"), endsAt: at("2026-09-15T17:00:00Z"),
    })).rejects.toBeDefined();
  });

  it("accepts session times exactly on the event boundaries", async () => {
    const created = await createSession({
      title: "Whole event",
      startsAt: at("2026-09-15T16:00:00Z"),
      endsAt: at("2026-09-17T01:00:00Z"),
    });
    expect(created.startsAt).toBe(at("2026-09-15T16:00:00Z"));
    expect(created.endsAt).toBe(at("2026-09-17T01:00:00Z"));
  });

  it("rejects a create before the event and an update after it", async () => {
    await expect(createSession({
      title: "Too early",
      startsAt: at("2026-09-15T15:59:59Z"),
      endsAt: at("2026-09-15T16:30:00Z"),
    })).rejects.toMatchObject({ code: "VALIDATION" });

    const created = await createSession({ title: "Still unscheduled" });
    await expect(saveSession(eventId, {
      id: created.id, expectedVersion: created.rowVersion, title: created.title,
      descriptionHtml: created.descriptionHtml, formatId: null, trackId: null, roomId: null,
      startsAt: at("2026-09-17T00:30:00Z"), endsAt: at("2026-09-17T01:00:01Z"),
      speakerContactIds: [], status: "draft",
    })).rejects.toMatchObject({ code: "VALIDATION" });

    const stored = await listSessions(eventId);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.startsAt).toBeNull();
    expect(stored[0]?.rowVersion).toBe(created.rowVersion);
  });

  it("gives colliding titles distinct slugs rather than failing", async () => {
    const first = await createSession({ title: "Same title" });
    const second = await createSession({ title: "Same title" });
    expect(first.slug).toBe("same-title");
    expect(second.slug).toBe("same-title-2");
  });

  it("deletes only on a matching version, and cascades its speakers", async () => {
    const created = await createSession({ title: "Doomed", speakerContactIds: [ada] });
    await expect(deleteSession(eventId, created.id, created.rowVersion + 5))
      .rejects.toMatchObject({ code: "STALE_WRITE" });
    await deleteSession(eventId, created.id, created.rowVersion);
    expect(await count("sessions")).toBe(0);
    expect(await count("session_speakers")).toBe(0);
  });

  it("excludes NULL-time rows from getSchedulableSessions but keeps them in listSessions", async () => {
    await createSession({ title: "Unplaced" });
    await createSession({
      title: "Placed", roomId: mainStage, status: "published",
      startsAt: at("2026-09-15T17:00:00Z"), endsAt: at("2026-09-15T17:30:00Z"),
    });
    expect(await listSessions(eventId)).toHaveLength(2);
    const schedulable = await getSchedulableSessions(eventId);
    expect(schedulable).toHaveLength(1);
    expect(schedulable[0]?.startsAtMs).toBe(Date.parse("2026-09-15T17:00:00Z"));
  });

  it("filters by the event-zone day key, not the UTC date", async () => {
    // 9pm PT on the 15th is 04:00Z on the 16th. Binning on the UTC date would
    // put this session on the wrong tab.
    await createSession({
      title: "Late night", roomId: studio, status: "published",
      startsAt: at("2026-09-16T04:00:00Z"), endsAt: at("2026-09-16T05:00:00Z"),
    });
    expect(await listSessions(eventId, { day: DAY_ONE })).toHaveLength(1);
    expect(await listSessions(eventId, { day: "2026-09-16" })).toHaveLength(0);
  });

  it("filters by search, track, room and status", async () => {
    await createSession({ title: "Retrieval deep dive", trackId: agentsTrack, roomId: mainStage });
    await createSession({ title: "Something else", roomId: studio, status: "published", startsAt: at("2026-09-15T17:00:00Z"), endsAt: at("2026-09-15T18:00:00Z") });
    expect(await listSessions(eventId, { search: "retrieval" })).toHaveLength(1);
    expect(await listSessions(eventId, { trackId: agentsTrack })).toHaveLength(1);
    expect(await listSessions(eventId, { roomId: studio })).toHaveLength(1);
    expect(await listSessions(eventId, { status: "published" })).toHaveLength(1);
    expect(await listSessions(eventId, { status: "all" })).toHaveLength(2);
  });

  it("scopes every read to its event", async () => {
    await createSession({ title: "Ours" });
    expect(await listSessions(otherEventId)).toHaveLength(0);
    expect(await getSchedulableSessions(otherEventId)).toHaveLength(0);
  });

  describe("moveSession", () => {
    it("rejects a final-slot rollover without changing the session", async () => {
      const created = await createSession({
        title: "Final slot", roomId: mainStage,
        startsAt: at("2026-09-17T00:00:00Z"), endsAt: at("2026-09-17T00:30:00Z"),
      });
      await expect(moveSession(eventId, {
        id: created.id, version: created.rowVersion,
        startsAt: at("2026-09-17T00:45:00Z"), endsAt: at("2026-09-17T01:15:00Z"), roomId: mainStage,
      })).rejects.toMatchObject({ code: "VALIDATION" });

      const stored = await listSessions(eventId);
      expect(stored[0]).toMatchObject({
        startsAt: created.startsAt,
        endsAt: created.endsAt,
        rowVersion: created.rowVersion,
      });
    });

    it("lets exactly one of two concurrent moves win, leaving the loser's revision untouched", async () => {
      const created = await createSession({
        title: "Contested slot", roomId: mainStage, status: "published",
        startsAt: at("2026-09-15T17:00:00Z"), endsAt: at("2026-09-15T17:30:00Z"),
        speakerContactIds: [ada],
      });
      const revisionBefore = created.scheduleRevision;

      const results = await Promise.allSettled([
        moveSession(eventId, {
          id: created.id, version: created.rowVersion,
          startsAt: at("2026-09-15T18:00:00Z"), endsAt: at("2026-09-15T18:30:00Z"), roomId: mainStage,
        }),
        moveSession(eventId, {
          id: created.id, version: created.rowVersion,
          startsAt: at("2026-09-15T19:00:00Z"), endsAt: at("2026-09-15T19:30:00Z"), roomId: studio,
        }),
      ]);
      const fulfilled = results.filter((result) => result.status === "fulfilled");
      const rejected = results.filter((result) => result.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      const reason = (rejected[0] as PromiseRejectedResult).reason;
      expect(isAppError(reason) && reason.code).toBe("STALE_WRITE");

      const row = await pglite.query<{ row_version: number; schedule_revision: number }>(
        "SELECT row_version, schedule_revision FROM sessions",
      );
      // One winner: one version bump and one revision bump, never two.
      expect(row.rows[0]?.row_version).toBe(created.rowVersion + 1);
      expect(row.rows[0]?.schedule_revision).toBe(revisionBefore + 1);
    });

    it("logs one row per speaker with the contract's idempotency key when a published session moves", async () => {
      const created = await createSession({
        title: "Moving", roomId: mainStage, status: "published",
        startsAt: at("2026-09-15T17:00:00Z"), endsAt: at("2026-09-15T17:30:00Z"),
        speakerContactIds: [ada, grace],
      });
      await pglite.exec("TRUNCATE communication_logs");

      const moved = await moveSession(eventId, {
        id: created.id, version: created.rowVersion,
        startsAt: at("2026-09-15T20:00:00Z"), endsAt: at("2026-09-15T20:30:00Z"), roomId: studio,
      });
      expect(moved.session.scheduleRevision).toBe(created.scheduleRevision + 1);
      const logs = await pglite.query<{ template_key: string; idempotency_key: string }>(
        "SELECT template_key, idempotency_key FROM communication_logs",
      );
      expect(logs.rows).toHaveLength(2);
      expect(logs.rows.every((row) => row.template_key === "schedule_changed")).toBe(true);
      expect(logs.rows.map((row) => row.idempotency_key).sort()).toEqual([
        idem.scheduled(eventId, created.id, ada, moved.session.scheduleRevision),
        idem.scheduled(eventId, created.id, grace, moved.session.scheduleRevision),
      ].sort());
    });

    it("enqueues nothing when a draft session moves", async () => {
      const created = await createSession({ title: "Draft move", speakerContactIds: [ada] });
      await moveSession(eventId, {
        id: created.id, version: created.rowVersion,
        startsAt: at("2026-09-15T21:00:00Z"), endsAt: at("2026-09-15T21:30:00Z"), roomId: mainStage,
      });
      expect(await count("communication_logs")).toBe(0);
    });

    it("returns the day's fresh conflicts inline", async () => {
      const first = await createSession({
        title: "Holder", roomId: mainStage, status: "published",
        startsAt: at("2026-09-15T17:00:00Z"), endsAt: at("2026-09-15T18:00:00Z"),
      });
      const second = await createSession({ title: "Mover", status: "draft" });
      const moved = await moveSession(eventId, {
        id: second.id, version: second.rowVersion,
        startsAt: at("2026-09-15T17:30:00Z"), endsAt: at("2026-09-15T18:30:00Z"), roomId: mainStage,
      });
      expect(moved.conflicts).toHaveLength(1);
      expect(moved.conflicts[0]).toMatchObject({ kind: "room", severity: "error", subjectId: mainStage });
      expect([moved.conflicts[0]?.a, moved.conflicts[0]?.b].sort()).toEqual([first.id, second.id].sort());
    });

    it("refuses a move against a session in another event", async () => {
      const created = await createSession({ title: "Ours only" });
      await expect(moveSession(otherEventId, {
        id: created.id, version: created.rowVersion,
        startsAt: at("2026-09-15T17:00:00Z"), endsAt: at("2026-09-15T17:30:00Z"), roomId: null,
      })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("promoteSubmission", () => {
    it("copies the abstract's fields and every participant, once", async () => {
      const { sessionId } = await promoteSubmission(eventId, acceptedTalk);
      const row = await pglite.query<{ title: string; status: string; track_id: string; submission_id: string; starts_at: string | null }>(
        "SELECT title, status, track_id, submission_id, starts_at FROM sessions",
      );
      expect(row.rows).toHaveLength(1);
      expect(row.rows[0]).toMatchObject({
        title: "Caching at the edge", status: "draft", track_id: agentsTrack, submission_id: acceptedTalk,
      });
      // No proto-session times on the abstract, so it lands in the tray.
      expect(row.rows[0]?.starts_at).toBeNull();

      const speakers = await pglite.query<{ contact_id: string; role: string }>(
        "SELECT contact_id, role FROM session_speakers ORDER BY sort_order",
      );
      expect(speakers.rows.map((speaker) => speaker.contact_id)).toEqual([ada, grace]);
      expect(speakers.rows.map((speaker) => speaker.role)).toEqual(["speaker", "co_speaker"]);

      const second = await promoteSubmission(eventId, acceptedTalk);
      expect(second.sessionId).toBe(sessionId);
      expect(await count("sessions")).toBe(1);
    });

    it("refuses an abstract that has not been accepted", async () => {
      await expect(promoteSubmission(eventId, pendingTalk)).rejects.toMatchObject({ code: "VALIDATION" });
      expect(await count("sessions")).toBe(0);
    });

    it("drops the abstract out of the promotion picker once it is linked", async () => {
      const before = await getAcceptedForScheduling(eventId);
      expect(before).toHaveLength(1);
      expect(before[0]).toMatchObject({ submissionId: acceptedTalk, alreadyPromoted: false, code: 1 });
      expect(before[0]?.speakers.map((speaker) => speaker.isPrimary)).toEqual([true, false]);

      await promoteSubmission(eventId, acceptedTalk);
      const after = await getAcceptedForScheduling(eventId);
      expect(after[0]?.alreadyPromoted).toBe(true);
    });
  });

  describe("bulkSetPublished", () => {
    it("publishes only the rows that changed, and notifies their speakers once", async () => {
      const first = await createSession({
        title: "Bulk one", roomId: mainStage, speakerContactIds: [ada],
        startsAt: at("2026-09-15T17:00:00Z"), endsAt: at("2026-09-15T17:30:00Z"),
      });
      const second = await createSession({
        title: "Bulk two", roomId: studio, speakerContactIds: [grace], status: "published",
        startsAt: at("2026-09-15T18:00:00Z"), endsAt: at("2026-09-15T18:30:00Z"),
      });
      await pglite.exec("TRUNCATE communication_logs");

      const result = await bulkSetPublished(eventId, [first.id, second.id], true);
      // `second` was already published, so it is not a change and not a second
      // round of mail.
      expect(result).toEqual({ changed: 1, emailsQueued: 1 });
      const logs = await pglite.query<{ template_key: string; contact_id: string }>(
        "SELECT template_key, contact_id FROM communication_logs",
      );
      expect(logs.rows).toEqual([{ template_key: "schedule_assigned", contact_id: ada }]);

      const again = await bulkSetPublished(eventId, [first.id, second.id], true);
      expect(again).toEqual({ changed: 0, emailsQueued: 0 });
    });

    it("unpublishes without enqueueing anything", async () => {
      const created = await createSession({
        title: "Retract", roomId: mainStage, speakerContactIds: [ada], status: "published",
        startsAt: at("2026-09-15T17:00:00Z"), endsAt: at("2026-09-15T17:30:00Z"),
      });
      await pglite.exec("TRUNCATE communication_logs");
      expect(await bulkSetPublished(eventId, [created.id], false)).toEqual({ changed: 1, emailsQueued: 0 });
      expect(await count("communication_logs")).toBe(0);
    });
  });

  describe("getMySessions", () => {
    it("returns only the caller's published scheduled sessions, with room and track names", async () => {
      await createSession({
        title: "Ada speaks", roomId: mainStage, trackId: agentsTrack, speakerContactIds: [ada], status: "published",
        startsAt: at("2026-09-15T17:00:00Z"), endsAt: at("2026-09-15T17:30:00Z"),
      });
      // Neither an unplaced draft nor a timed draft can cross the publication
      // boundary into the speaker portal.
      await createSession({ title: "Ada's unplaced idea", speakerContactIds: [ada] });
      await createSession({
        title: "Ada's tentative slot", roomId: studio, speakerContactIds: [ada], status: "draft",
        startsAt: at("2026-09-15T19:00:00Z"), endsAt: at("2026-09-15T19:30:00Z"),
      });
      await createSession({
        title: "Grace speaks", roomId: studio, speakerContactIds: [grace], status: "published",
        startsAt: at("2026-09-15T18:00:00Z"), endsAt: at("2026-09-15T18:30:00Z"),
      });

      const mine = await getMySessions(eventId, ada);
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({ title: "Ada speaks", roomName: "Main Stage", trackName: "AI Agents" });
      expect(mine.map((session) => session.title)).not.toContain("Ada's tentative slot");

      // A mismatched contact sees nothing, not somebody else's schedule.
      expect(await getMySessions(eventId, alan)).toEqual([]);
      expect(await getMySessions(otherEventId, ada)).toEqual([]);
    });
  });

  it("exposes the event's vocabulary for the dialog's dropdowns", async () => {
    const vocabulary = await listAgendaVocabulary(eventId);
    expect(vocabulary.rooms.map((room) => room.name)).toEqual(["Main Stage", "Studio"]);
    expect(vocabulary.tracks.map((track) => track.name)).toEqual(["AI Agents"]);
    expect(vocabulary.speakers.map((speaker) => speaker.name)).toContain("Ada Lovelace");
    expect(await listAgendaVocabulary(otherEventId)).toMatchObject({ rooms: [], tracks: [], speakers: [] });
  });

  it("does not flag a back-to-back pair in the same room", async () => {
    await createSession({
      title: "First half", roomId: mainStage, status: "published",
      startsAt: at("2026-09-15T17:00:00Z"), endsAt: at("2026-09-15T17:30:00Z"),
    });
    await createSession({
      title: "Second half", roomId: mainStage, status: "published",
      startsAt: at("2026-09-15T17:30:00Z"), endsAt: at("2026-09-15T18:00:00Z"),
    });
    expect(detectConflicts(await getSchedulableSessions(eventId))).toEqual([]);
  });

  it("keeps a session with a deleted room and track renderable as a null-valued row", async () => {
    const created = await createSession({ title: "Orphaned", roomId: mainStage, trackId: agentsTrack });
    await pglite.query("DELETE FROM rooms WHERE id = $1", [mainStage]);
    await pglite.query("DELETE FROM tracks WHERE id = $1", [agentsTrack]);
    const rows = await listSessions(eventId);
    expect(rows[0]).toMatchObject({ id: created.id, roomId: null, trackId: null });
    // Put the vocabulary back for the suites that follow.
    await pglite.query("INSERT INTO rooms(id,event_id,name,capacity,sort_order) VALUES($1,$2,'Main Stage',100,0)", [mainStage, eventId]);
    await pglite.query("INSERT INTO tracks(id,event_id,name,color,sort_order) VALUES($1,$2,'AI Agents','#6958d7',0)", [agentsTrack, eventId]);
  });

  it("refuses a session id that belongs to nobody", async () => {
    await expect(deleteSession(eventId, sessionIdSchema.parse("a8000000-0000-4000-8000-0000000000ff"), 1))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
