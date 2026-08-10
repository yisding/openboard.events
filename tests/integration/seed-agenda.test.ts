import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import { detectConflicts, toScheduledSession } from "@/features/agenda/conflicts";
import { scheduledSessionDtoSchema, type ScheduledSessionDTO } from "@/shared/contracts";
import { eventDayKey } from "@/shared/lib/time";
import { seedAgenda } from "../../scripts/seed/agenda";
import { EVENT_TIMEZONE, eventLocal, SEEDED_EMPTY_EVENT_ID, SEEDED_EVENT_ID } from "../../scripts/seed/lib/helpers";
import { seedId } from "../../scripts/seed/lib/ids";

const migration0 = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");

const TRACKS = ["agents", "platforms", "security", "community"];
const ROOMS = ["main-stage", "workshop-a", "workshop-b", "studio", "atrium"];
const FORMATS = ["keynote", "talk", "workshop", "panel", "break"];
const CONTACTS = ["ada", "grace", "alan", "katherine", "margaret", "barbara", "tim", "radia", "linus", "sophie", "james", "shafi"];

const now = new Date("2026-08-09T12:00:00.000Z");

describe("agenda seed", () => {
  let pglite: PGlite;
  const logs: string[] = [];

  async function run(): Promise<void> {
    await seedAgenda({
      tx: drizzle(pglite, { schema }) as unknown as TxDb,
      now,
      eventId: SEEDED_EVENT_ID,
      emptyEventId: SEEDED_EMPTY_EVENT_ID,
      id: seedId,
      log: (message: string) => logs.push(message),
    });
  }

  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migration0);
    await pglite.exec(migration1);
    await pglite.query(
      "INSERT INTO events(id,name,slug,timezone,starts_at,ends_at) VALUES($1,'Seed Event','seed-event',$2,$3,$4)",
      [SEEDED_EVENT_ID, EVENT_TIMEZONE, eventLocal(now, 65, "09:00").toISOString(), eventLocal(now, 67, "17:00").toISOString()],
    );
    for (const [index, key] of TRACKS.entries()) {
      await pglite.query("INSERT INTO tracks(id,event_id,name,color,sort_order) VALUES($1,$2,$3,'#6958d7',$4)", [seedId("track", key), SEEDED_EVENT_ID, key, index]);
    }
    for (const [index, key] of ROOMS.entries()) {
      await pglite.query("INSERT INTO rooms(id,event_id,name,capacity,sort_order) VALUES($1,$2,$3,100,$4)", [seedId("room", key), SEEDED_EVENT_ID, key, index]);
    }
    for (const [index, key] of FORMATS.entries()) {
      await pglite.query("INSERT INTO session_formats(id,event_id,name,default_duration_mins,sort_order) VALUES($1,$2,$3,30,$4)", [seedId("format", key), SEEDED_EVENT_ID, key, index]);
    }
    for (const key of CONTACTS) {
      await pglite.query("INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES($1,$2,$3,$4,'Seeded')", [seedId("contact", key), SEEDED_EVENT_ID, `${key}@openboard.dev`, key]);
    }

    // Twice, because M09's contract is that a second `pnpm seed` is a no-op.
    await run();
    await run();
  }, 60_000);

  afterAll(async () => {
    await pglite.close();
  });

  async function sessionDtos(): Promise<ScheduledSessionDTO[]> {
    const rows = await pglite.query<{
      id: string; title: string; slug: string; description_html: string | null;
      starts_at: string | null; ends_at: string | null; track_id: string | null; room_id: string | null;
      format_id: string | null; status: "draft" | "published"; schedule_revision: number; row_version: number;
      speaker_ids: string[] | null;
    }>(`
      SELECT s.*, (SELECT coalesce(array_agg(ss.contact_id ORDER BY ss.sort_order), '{}')
                   FROM session_speakers ss WHERE ss.session_id = s.id) AS speaker_ids
      FROM sessions s ORDER BY s.starts_at NULLS LAST, s.title
    `);
    return rows.rows.map((row) => scheduledSessionDtoSchema.parse({
      id: row.id,
      title: row.title,
      slug: row.slug,
      descriptionHtml: row.description_html ?? "",
      startsAt: row.starts_at === null ? null : new Date(row.starts_at).toISOString(),
      endsAt: row.ends_at === null ? null : new Date(row.ends_at).toISOString(),
      trackId: row.track_id,
      roomId: row.room_id,
      formatId: row.format_id,
      status: row.status,
      scheduleRevision: Number(row.schedule_revision),
      rowVersion: Number(row.row_version),
      speakerIds: row.speaker_ids ?? [],
    }));
  }

  it("is idempotent: two runs leave exactly 15 sessions, three of them unscheduled", async () => {
    const sessions = await sessionDtos();
    expect(sessions).toHaveLength(15);
    expect(sessions.filter((session) => session.startsAt === null)).toHaveLength(3);
    expect(sessions.filter((session) => session.status === "published")).toHaveLength(12);
  });

  it("keeps one speaker row per seeded speaker after a re-run", async () => {
    const rows = await pglite.query<{ n: number }>("SELECT count(*)::int AS n FROM session_speakers");
    // Thirteen sessions with one speaker, the closing panel with two, and the
    // lightning-talks tray row with none: 13 + 2 = 15. A second run that merged
    // rather than replaced would double this.
    expect(rows.rows[0]?.n).toBe(15);
  });

  it("flags exactly the two named conflict pairs, and nothing else", async () => {
    const schedulable = (await sessionDtos()).flatMap((session) => {
      const normalized = toScheduledSession(session);
      return normalized ? [normalized] : [];
    });
    const conflicts = detectConflicts(schedulable);
    expect(conflicts).toHaveLength(2);

    const byId = new Map((await sessionDtos()).map((session) => [session.id, session.title]));
    const pairs = conflicts.map((conflict) => ({
      kind: conflict.kind,
      titles: [byId.get(conflict.a) ?? "", byId.get(conflict.b) ?? ""].sort(),
    }));

    const roomPair = pairs.find((pair) => pair.kind === "room");
    const speakerPair = pairs.find((pair) => pair.kind === "speaker");
    expect(roomPair?.titles.every((title) => title.startsWith("⚠ Demo conflict A"))).toBe(true);
    expect(speakerPair?.titles.every((title) => title.startsWith("⚠ Demo conflict B"))).toBe(true);
  });

  it("does not flag the back-to-back pair", async () => {
    const sessions = await sessionDtos();
    const first = sessions.find((session) => session.title.startsWith("Caching at the edge"));
    const second = sessions.find((session) => session.title.startsWith("Evals that survive"));
    expect(first?.endsAt).toBe(second?.startsAt);
    expect(first?.roomId).toBe(second?.roomId);
  });

  it("bins every placed session onto an event-zone day, not a UTC one", async () => {
    const days = new Set((await sessionDtos())
      .filter((session) => session.startsAt !== null)
      .map((session) => eventDayKey(session.startsAt as string, EVENT_TIMEZONE)));
    expect(days.size).toBe(2);
    for (const day of days) expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("leaves the tray's fully-empty row renderable — no track, no room, no speakers", async () => {
    const lightning = (await sessionDtos()).find((session) => session.title.startsWith("Lightning talks"));
    expect(lightning).toMatchObject({ startsAt: null, endsAt: null, trackId: null, roomId: null, formatId: null, speakerIds: [] });
  });

  it("gives published, placed sessions a schedule revision of 1", async () => {
    const sessions = await sessionDtos();
    for (const session of sessions) {
      expect(session.scheduleRevision).toBe(session.status === "published" && session.startsAt !== null ? 1 : 0);
    }
  });
});
