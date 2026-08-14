import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbOrTx } from "@/db/client";
import * as schema from "@/db/schema";
import { restoreSessionContentIn, saveSessionIn } from "@/features/agenda/server/mutations";
import { updateEventIn } from "@/features/events/server/mutations";
import { deleteVocabItemIn, patchVocabItemIn } from "@/features/events/server/vocab";
import { buildPublicScheduleIcsIn } from "@/features/public/server/public-ics";
import { eventIdSchema, sessionIdSchema } from "@/shared/contracts";
import { parseEnv } from "@/shared/lib/env";

function required<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) throw new Error(message);
  return value;
}

const migration0 = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");
const migrationReviewOps = readFileSync(new URL("../../drizzle/0004_review_operations.sql", import.meta.url), "utf8");
const migrationContentRevisions = readFileSync(new URL("../../drizzle/0006_content_deliverables.sql", import.meta.url), "utf8");
const migrationEmailCompliance = readFileSync(new URL("../../drizzle/0007_email_compliance.sql", import.meta.url), "utf8");
const migrationOrganizationTenancy = readFileSync(new URL("../../drizzle/0010_organization_tenancy.sql", import.meta.url), "utf8");
const migrationPublicScheduleRevision = readFileSync(new URL("../../drizzle/0034_public_schedule_revision.sql", import.meta.url), "utf8");

const env = parseEnv({
  APP_ENV: "local",
  APP_BASE_URL: "https://events.example.com",
  EMAIL_MODE: "log",
  EMAIL_FROM: "Openboard <hello@events.example.com>",
});

const eventId = eventIdSchema.parse("c1000000-0000-4000-8000-000000000001");
const eventSlug = "test-event";
const speakerId = "c1000000-0000-4000-8000-000000000020";
const sessionKeep = "c1000000-0000-4000-8000-000000000030";
const sessionRemove = "c1000000-0000-4000-8000-000000000031";
const sessionDraft = "c1000000-0000-4000-8000-000000000032";
const roomOriginal = "c1000000-0000-4000-8000-000000000040";
const roomUpdated = "c1000000-0000-4000-8000-000000000041";
const sessionContent = sessionIdSchema.parse("c1000000-0000-4000-8000-000000000050");
const originalContentRevision = "c1000000-0000-4000-8000-000000000051";
const sessionRoomVocabulary = "c1000000-0000-4000-8000-000000000060";
const roomVocabulary = "c1000000-0000-4000-8000-000000000061";
const metadataEventId = eventIdSchema.parse("c1000000-0000-4000-8000-000000000070");
const metadataSession = sessionIdSchema.parse("c1000000-0000-4000-8000-000000000071");
const metadataDraftSession = "c1000000-0000-4000-8000-000000000072";

let pglite: PGlite;
let db: DbOrTx;

describe("buildPublicScheduleIcsIn (M53 anonymous itinerary export, reuses M35's builder)", () => {
  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migration0);
    await pglite.exec(migration1);
    await pglite.exec(migrationReviewOps);
    await pglite.exec(migrationContentRevisions);
    await pglite.exec(migrationEmailCompliance);
    await pglite.exec(migrationOrganizationTenancy);
    await pglite.exec(migrationPublicScheduleRevision);
    db = drizzle(pglite, { schema }) as unknown as DbOrTx;

    await pglite.query(
      "INSERT INTO events(id,name,slug,timezone,starts_at,ends_at) VALUES($1,'Test Event','test-event','America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
      [eventId],
    );
    await pglite.query(
      "INSERT INTO contacts(id,event_id,email,first_name,last_name,confirmation_status) VALUES($1,$2,'ada@example.com','Ada','Lovelace','confirmed')",
      [speakerId, eventId],
    );
    await pglite.query(
      "INSERT INTO rooms(id,event_id,name) VALUES($1,$2,'Auditorium'),($3,$2,'Garden Stage')",
      [roomOriginal, eventId, roomUpdated],
    );
    await pglite.query(
      "INSERT INTO sessions(id,event_id,title,slug,description_html,starts_at,ends_at,status,schedule_revision,room_id) VALUES($1,$2,'Keep Me','keep-me','<p>Keep description</p>','2026-09-16T05:30:00Z','2026-09-16T06:00:00Z','published',3,$3)",
      [sessionKeep, eventId, roomOriginal],
    );
    await pglite.query(
      "INSERT INTO sessions(id,event_id,title,slug,starts_at,ends_at,status) VALUES($1,$2,'Also Published','also-published','2026-09-16T07:00:00Z','2026-09-16T07:30:00Z','published')",
      [sessionRemove, eventId],
    );
    await pglite.query(
      "INSERT INTO sessions(id,event_id,title,slug,starts_at,ends_at,status) VALUES($1,$2,'Still A Draft','still-a-draft','2026-09-16T08:00:00Z','2026-09-16T08:30:00Z','draft')",
      [sessionDraft, eventId],
    );
    await pglite.query("INSERT INTO session_speakers(event_id,session_id,contact_id,sort_order) VALUES($1,$2,$3,0)", [eventId, sessionKeep, speakerId]);
  });

  afterAll(async () => {
    await pglite.close();
  });

  it("returns null for an unknown slug instead of throwing", async () => {
    expect(await buildPublicScheduleIcsIn(db, "no-such-event", null, env)).toBeNull();
  });

  it("with sessionIds=null, includes every published session and excludes drafts", async () => {
    const { ics } = required(await buildPublicScheduleIcsIn(db, eventSlug, null, env), "expected a calendar");
    expect(ics).toContain("SUMMARY:Keep Me");
    expect(ics).toContain("SUMMARY:Also Published");
    expect(ics).not.toContain("Still A Draft");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
  });

  it("star two, remove one: the exported calendar contains only the remaining session", async () => {
    // Simulates the itinerary's localStorage reconciliation already having
    // dropped `sessionRemove` (removed from My Schedule) — the caller passes
    // only the ids that are still starred, exactly what the itinerary UI does.
    const { ics } = required(await buildPublicScheduleIcsIn(db, eventSlug, [sessionKeep], env), "expected a calendar");
    expect(ics).toContain("SUMMARY:Keep Me");
    expect(ics).not.toContain("SUMMARY:Also Published");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  });

  it("silently drops an id that is no longer published (unpublished/deleted-id reconciliation)", async () => {
    const { ics } = required(await buildPublicScheduleIcsIn(db, eventSlug, [sessionKeep, sessionDraft, "not-a-real-id"], env), "expected a calendar");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).toContain("SUMMARY:Keep Me");
  });

  it("an empty selection produces a valid, empty calendar rather than falling back to the full schedule", async () => {
    const { ics } = required(await buildPublicScheduleIcsIn(db, eventSlug, [], env), "expected a calendar");
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("END:VCALENDAR");
    expect(ics).not.toContain("BEGIN:VEVENT");
  });

  it("every event is a plain feed entry, never a REQUEST/CANCEL invite (no attendee required)", async () => {
    const { ics } = required(await buildPublicScheduleIcsIn(db, eventSlug, [sessionKeep], env), "expected a calendar");
    expect(ics).not.toContain("METHOD:REQUEST");
    expect(ics).not.toContain("METHOD:CANCEL");
    expect(ics).not.toContain("ATTENDEE");
    expect(ics).toContain("STATUS:CONFIRMED");
  });

  it("advances one stable calendar event through a direct content edit and restore", async () => {
    await pglite.query(
      "INSERT INTO sessions(id,event_id,title,slug,description_html,starts_at,ends_at,status,schedule_revision) VALUES($1,$2,'Original Summary','content-revisions','<p>Original details</p>','2026-09-16T04:00:00Z','2026-09-16T04:30:00Z','published',5)",
      [sessionContent, eventId],
    );
    await pglite.query(
      "INSERT INTO session_content_revisions(id,event_id,session_id,title,description_html) VALUES($1,$2,$3,'Original Summary','<p>Original details</p>')",
      [originalContentRevision, eventId, sessionContent],
    );

    try {
      const original = required(await buildPublicScheduleIcsIn(db, eventSlug, [sessionContent], env), "expected original content calendar");
      const edited = await saveSessionIn(db, eventId, {
        id: sessionContent,
        expectedVersion: 1,
        title: "Edited Summary",
        descriptionHtml: "<p>Edited details</p>",
        formatId: null,
        trackId: null,
        roomId: null,
        startsAt: "2026-09-16T04:00:00.000Z",
        endsAt: "2026-09-16T04:30:00.000Z",
        speakerContactIds: [],
        status: "published",
      });
      const afterEdit = required(await buildPublicScheduleIcsIn(db, eventSlug, [sessionContent], env), "expected edited content calendar");

      expect(edited.scheduleRevision).toBe(6);
      expect(uidOf(afterEdit.ics)).toBe(uidOf(original.ics));
      expect(afterEdit.ics).toContain("SEQUENCE:6\r\n");
      expect(afterEdit.ics).toContain("SUMMARY:Edited Summary\r\n");
      expect(afterEdit.ics).toContain("DESCRIPTION:Edited details\r\n");

      const restored = await restoreSessionContentIn(db, eventId, sessionContent, originalContentRevision, null);
      const afterRestore = required(await buildPublicScheduleIcsIn(db, eventSlug, [sessionContent], env), "expected restored content calendar");

      expect(restored.scheduleRevision).toBe(7);
      expect(uidOf(afterRestore.ics)).toBe(uidOf(original.ics));
      expect(afterRestore.ics).toContain("SEQUENCE:7\r\n");
      expect(afterRestore.ics).toContain("SUMMARY:Original Summary\r\n");
      expect(afterRestore.ics).toContain("DESCRIPTION:Original details\r\n");
    } finally {
      await pglite.query("DELETE FROM sessions WHERE id=$1", [sessionContent]);
    }
  });

  it("advances one stable calendar event when its assigned room is renamed and deleted", async () => {
    await pglite.query("INSERT INTO rooms(id,event_id,name) VALUES($1,$2,'Workshop Room')", [roomVocabulary, eventId]);
    await pglite.query(
      "INSERT INTO sessions(id,event_id,title,slug,starts_at,ends_at,status,schedule_revision,room_id) VALUES($1,$2,'Room-sensitive Session','room-sensitive','2026-09-16T04:30:00Z','2026-09-16T05:00:00Z','published',8,$3)",
      [sessionRoomVocabulary, eventId, roomVocabulary],
    );

    try {
      const original = required(await buildPublicScheduleIcsIn(db, eventSlug, [sessionRoomVocabulary], env), "expected original room calendar");
      expect(original.ics).toContain("SEQUENCE:8\r\n");
      expect(original.ics).toContain("LOCATION:Workshop Room\r\n");

      await patchVocabItemIn(db, eventId, "rooms", roomVocabulary, { name: "Renamed Workshop" });
      const afterRename = required(await buildPublicScheduleIcsIn(db, eventSlug, [sessionRoomVocabulary], env), "expected renamed room calendar");
      expect(uidOf(afterRename.ics)).toBe(uidOf(original.ics));
      expect(afterRename.ics).toContain("SEQUENCE:9\r\n");
      expect(afterRename.ics).toContain("LOCATION:Renamed Workshop\r\n");

      await deleteVocabItemIn(db, eventId, "rooms", roomVocabulary);
      const afterDelete = required(await buildPublicScheduleIcsIn(db, eventSlug, [sessionRoomVocabulary], env), "expected deleted room calendar");
      expect(uidOf(afterDelete.ics)).toBe(uidOf(original.ics));
      expect(afterDelete.ics).toContain("SEQUENCE:10\r\n");
      expect(afterDelete.ics).toContain("LOCATION:\r\n");
    } finally {
      await pglite.query("DELETE FROM sessions WHERE id=$1", [sessionRoomVocabulary]);
      await pglite.query("DELETE FROM rooms WHERE id=$1", [roomVocabulary]);
    }
  });

  it("advances public sessions once for a combined event name and slug edit, but not for no-op or unrelated edits", async () => {
    await pglite.query(
      "INSERT INTO events(id,name,slug,timezone,starts_at,ends_at) VALUES($1,'Metadata Event','metadata-event','America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
      [metadataEventId],
    );
    await pglite.query(
      "INSERT INTO sessions(id,event_id,title,slug,starts_at,ends_at,status,schedule_revision) VALUES($1,$2,'Metadata Session','metadata-session','2026-09-16T05:00:00Z','2026-09-16T05:30:00Z','published',11),($3,$2,'Draft Metadata Session','draft-metadata-session','2026-09-16T06:00:00Z','2026-09-16T06:30:00Z','draft',20)",
      [metadataSession, metadataEventId, metadataDraftSession],
    );

    try {
      const original = required(await buildPublicScheduleIcsIn(db, "metadata-event", [metadataSession], env), "expected original metadata calendar");
      const renamed = await updateEventIn(db, metadataEventId, { name: "Renamed Event", slug: "renamed-event" }, 1);
      const afterRename = required(await buildPublicScheduleIcsIn(db, "renamed-event", [metadataSession], env), "expected renamed metadata calendar");
      const unfoldedRename = unfoldIcs(afterRename.ics);

      expect(uidOf(afterRename.ics)).toBe(uidOf(original.ics));
      expect(afterRename.ics).toContain("SEQUENCE:12\r\n");
      expect(afterRename.ics).toContain('ORGANIZER;CN="Renamed Event":mailto:hello@events.example.com\r\n');
      expect(unfoldedRename).toContain(`URL:https://events.example.com/e/renamed-event/agenda?session=${metadataSession}\r\n`);

      const noOp = await updateEventIn(db, metadataEventId, { name: "Renamed Event", slug: "renamed-event" }, renamed.rowVersion);
      const unrelated = await updateEventIn(db, metadataEventId, { physicalAddress: "123 Main St" }, noOp.rowVersion);
      const afterUnrelated = required(await buildPublicScheduleIcsIn(db, "renamed-event", [metadataSession], env), "expected metadata calendar after unrelated edit");
      const revisions = await pglite.query<{ id: string; schedule_revision: number }>(
        "SELECT id,schedule_revision FROM sessions WHERE event_id=$1 ORDER BY id",
        [metadataEventId],
      );

      expect(unrelated.physicalAddress).toBe("123 Main St");
      expect(afterUnrelated.ics).toContain("SEQUENCE:12\r\n");
      expect(revisions.rows).toEqual([
        { id: metadataSession, schedule_revision: 12 },
        { id: metadataDraftSession, schedule_revision: 20 },
      ]);
    } finally {
      await pglite.query("DELETE FROM events WHERE id=$1", [metadataEventId]);
    }
  });

  it("keeps the UID stable while advancing sequence, time, and location with a schedule revision", async () => {
    const first = required(await buildPublicScheduleIcsIn(db, eventSlug, [sessionKeep], env), "expected a calendar");
    expect(first.ics).toContain("SEQUENCE:3\r\n");
    expect(first.ics).toContain("DTSTART:20260916T053000Z\r\n");
    expect(first.ics).toContain("DTEND:20260916T060000Z\r\n");
    expect(first.ics).toContain("LOCATION:Auditorium\r\n");

    await pglite.query(
      "UPDATE sessions SET starts_at='2026-09-16T06:30:00Z',ends_at='2026-09-16T07:15:00Z',room_id=$2,schedule_revision=4 WHERE id=$1",
      [sessionKeep, roomUpdated],
    );

    const second = required(await buildPublicScheduleIcsIn(db, eventSlug, [sessionKeep], env), "expected a calendar");
    expect(uidOf(first.ics)).toBe(uidOf(second.ics));
    expect(second.ics).toContain("SEQUENCE:4\r\n");
    expect(second.ics).toContain("DTSTART:20260916T063000Z\r\n");
    expect(second.ics).toContain("DTEND:20260916T071500Z\r\n");
    expect(second.ics).toContain("LOCATION:Garden Stage\r\n");
  });
});

function uidOf(ics: string): string | undefined {
  return /UID:([^\r\n]+)/.exec(ics)?.[1];
}

function unfoldIcs(ics: string): string {
  return ics.replaceAll("\r\n ", "");
}
