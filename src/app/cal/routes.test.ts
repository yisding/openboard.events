import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import { issuePortalToken, verifyPortalTokenIn } from "@/features/auth/server/tokens";
import { contactIdSchema, eventIdSchema } from "@/shared/contracts";
import { parseEnv } from "@/shared/lib/env";
import { calendarDownloadResponse, calendarFeedResponse } from "./_responses";

const migration0 = readFileSync(new URL("../../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");
// M50 is additive on top of the base schema; applying it keeps this fixture
// aligned with the columns the repository modules now read.
const migrationReviewOps = readFileSync(new URL("../../../drizzle/0004_review_operations.sql", import.meta.url), "utf8");
const migrationCalendarCancellationSnapshots = readFileSync(new URL("../../../drizzle/0043_calendar_cancellation_snapshots.sql", import.meta.url), "utf8");
const eventId = eventIdSchema.parse("d0000000-0000-4000-8000-000000000001");
const speakerId = contactIdSchema.parse("d0000000-0000-4000-8000-000000000002");
const emptySpeakerId = contactIdSchema.parse("d0000000-0000-4000-8000-000000000003");
const droppedSpeakerId = contactIdSchema.parse("d0000000-0000-4000-8000-000000000007");
const sessionId = "d0000000-0000-4000-8000-000000000004";
const draftSessionId = "d0000000-0000-4000-8000-000000000005";
const otherSessionId = "d0000000-0000-4000-8000-000000000006";
const env = parseEnv({
  APP_ENV: "local",
  APP_BASE_URL: "https://events.example.com",
  SESSION_SECRET: "calendar-route-test-secret-at-least-32-bytes",
  EMAIL_MODE: "log",
  EMAIL_FROM: "mail@events.example.com",
});

describe("calendar token routes", () => {
  let pglite: PGlite;
  let tx: TxDb;

  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migration0);
    await pglite.exec(migration1);
    await pglite.exec(migrationReviewOps);
    await pglite.exec(migrationCalendarCancellationSnapshots);
    await pglite.query(
      "INSERT INTO events(id,name,slug,location,timezone,starts_at,ends_at) VALUES($1,'AI Engineer','ai-engineer','Fort Mason','America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
      [eventId],
    );
    await pglite.query(
      "INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES($1,$4,'speaker@example.com','Nadia','Lee'),($2,$4,'empty@example.com','Empty','Speaker'),($3,$4,'dropped@example.com','Ola','Rune')",
      [speakerId, emptySpeakerId, droppedSpeakerId, eventId],
    );
    await pglite.query(
      "INSERT INTO sessions(id,event_id,title,slug,description_html,starts_at,ends_at,status,schedule_revision) VALUES($1,$4,'Published talk','published-talk','<p>Useful details</p>','2026-09-15T18:00:00Z','2026-09-15T18:30:00Z','published',3),($2,$4,'Draft talk','draft-talk',NULL,'2026-09-15T19:00:00Z','2026-09-15T19:30:00Z','draft',0),($3,$4,'Other talk','other-talk',NULL,'2026-09-15T20:00:00Z','2026-09-15T20:30:00Z','published',1)",
      [sessionId, draftSessionId, otherSessionId, eventId],
    );
    await pglite.query(
      "INSERT INTO session_speakers(event_id,session_id,contact_id) VALUES($1,$2,$3),($1,$4,$3),($1,$4,$5)",
      [eventId, sessionId, speakerId, draftSessionId, droppedSpeakerId],
    );
    await pglite.query(
      `INSERT INTO calendar_invites(event_id,contact_id,session_id,ics_uid,sequence,last_method,organizer_email,event_snapshot)
       VALUES($1,$2,$3,'stable-invite@events.example.com',3,'request','mail@events.example.com',$4::jsonb)`,
      [eventId, speakerId, sessionId, JSON.stringify({
        version: 1, eventId, sessionId, contactId: speakerId,
        title: "Published talk", descriptionHtml: "<p>Useful details</p>",
        startsAt: "2026-09-15T18:00:00.000Z", endsAt: "2026-09-15T18:30:00.000Z",
        room: null, track: null, eventName: "AI Engineer", eventSlug: "ai-engineer",
        eventLocation: "Fort Mason", eventTimezone: "America/Los_Angeles",
        attendeeEmail: "speaker@example.com", attendeeFirstName: "Nadia", attendeeLastName: "Lee",
      })],
    );
    // Ola was invited to this session while it was published; it has since been
    // unpublished, so the live feed no longer returns it and only the invite
    // row remembers what her calendar is still showing.
    await pglite.query(
      `INSERT INTO calendar_invites(event_id,contact_id,session_id,ics_uid,sequence,last_method,organizer_email,event_snapshot)
       VALUES($1,$2,$3,'dropped-invite@events.example.com',2,'request','mail@events.example.com',$4::jsonb)`,
      [eventId, droppedSpeakerId, draftSessionId, JSON.stringify({
        version: 1, eventId, sessionId: draftSessionId, contactId: droppedSpeakerId,
        title: "Draft talk", descriptionHtml: null,
        startsAt: "2026-09-15T19:00:00.000Z", endsAt: "2026-09-15T19:30:00.000Z",
        room: null, track: null, eventName: "AI Engineer", eventSlug: "ai-engineer",
        eventLocation: "Fort Mason", eventTimezone: "America/Los_Angeles",
        attendeeEmail: "dropped@example.com", attendeeFirstName: "Ola", attendeeLastName: "Rune",
      })],
    );
    tx = drizzle(pglite, { schema }) as unknown as TxDb;
  }, 30_000);

  beforeEach(async () => {
    await pglite.query("DELETE FROM portal_tokens");
  });

  afterAll(async () => pglite.close());

  async function tokenFor(contactId: typeof speakerId | typeof emptySpeakerId | typeof droppedSpeakerId) {
    return issuePortalToken(tx, { contactId, eventId, purpose: "ics_download", ttl: "P1D" });
  }

  const verify = (raw: string, options: { purpose: "ics_download" }) => verifyPortalTokenIn(tx, raw, options);

  it("returns a reusable METHOD-less speaker feed with stable invite identity", async () => {
    const token = await tokenFor(speakerId);
    const first = await calendarFeedResponse(token.raw, { dbOrTx: tx, env, verify });
    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(first.headers.get("content-disposition")).toBe("inline");
    expect(first.headers.get("cache-control")).toBe("private, max-age=300");
    const body = await first.text();
    expect(body).toContain("X-WR-CALNAME:AI Engineer — Nadia Lee");
    expect(body).toContain("UID:stable-invite@events.example.com");
    expect(body).toContain("SEQUENCE:3");
    expect(body).toContain("LOCATION:Fort Mason");
    expect(body).not.toContain("METHOD:");
    expect(body).toContain("STATUS:CONFIRMED");
    // Nadia's invite row is for a session that is still live, so it is the one
    // CONFIRMED event and never also a tombstone.
    expect(body).not.toContain("STATUS:CANCELLED");
    expect(body.match(/BEGIN:VEVENT/g)).toHaveLength(1);

    const second = await calendarFeedResponse(token.raw, { dbOrTx: tx, env, verify });
    expect(second.status).toBe(200);
    const tokenState = await pglite.query<{ consumed: boolean }>(
      "SELECT consumed_at IS NOT NULL AS consumed FROM portal_tokens WHERE id=$1",
      [token.tokenId],
    );
    expect(tokenState.rows[0]?.consumed).toBe(false);
  });

  it("returns a speaker-scoped METHOD:PUBLISH download", async () => {
    const token = await tokenFor(speakerId);
    const response = await calendarDownloadResponse(token.raw, sessionId, { dbOrTx: tx, env, verify });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="invite.ics"');
    expect(response.headers.get("cache-control")).toBe("private, max-age=300");
    const body = await response.text();
    expect(body).toContain("METHOD:PUBLISH");
    expect(body).toContain("UID:stable-invite@events.example.com");
    expect(body).not.toContain("ATTENDEE");

    const unrelated = await calendarDownloadResponse(token.raw, otherSessionId, { dbOrTx: tx, env, verify });
    expect(unrelated.status).toBe(404);
    const draft = await calendarDownloadResponse(token.raw, draftSessionId, { dbOrTx: tx, env, verify });
    expect(draft.status).toBe(404);
  });

  it("returns 404 for a tampered token without exposing session existence", async () => {
    const feed = await calendarFeedResponse("tampered", { dbOrTx: tx, env, verify });
    const download = await calendarDownloadResponse("tampered", sessionId, { dbOrTx: tx, env, verify });
    expect(feed.status).toBe(404);
    expect(download.status).toBe(404);
    await expect(feed.json()).resolves.toMatchObject({ error: { code: "NOT_FOUND" } });
    await expect(download.json()).resolves.toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  it("returns 404 for a malformed session UUID without querying", async () => {
    const verify = vi.fn(async () => null);
    const response = await calendarDownloadResponse("valid-looking-token", "not-a-uuid", {
      dbOrTx: tx,
      env,
      verify,
    });
    expect(response.status).toBe(404);
    expect(verify).not.toHaveBeenCalled();
  });

  it("keeps a dropped session in the feed as a cancellation so subscribers lose it", async () => {
    const token = await tokenFor(droppedSpeakerId);
    const response = await calendarFeedResponse(token.raw, { dbOrTx: tx, env, verify });
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    // Same UID the speaker's calendar already holds — a new one would add a
    // second event rather than remove the stale one.
    expect(body).toContain("UID:dropped-invite@events.example.com");
    expect(body).toContain("STATUS:CANCELLED");
    // The snapshot taken at invite time, not a re-read of the mutable session.
    expect(body).toContain("SUMMARY:Draft talk");
    // No cancellation has been dispatched yet, so the feed is first to report
    // it and has to step past the CONFIRMED copy at SEQUENCE:2.
    expect(body).toContain("SEQUENCE:3");
    expect(body).not.toContain("METHOD:");
    expect(body).not.toContain("ATTENDEE");
  });

  it("reuses the sequence a dispatched cancellation already claimed", async () => {
    await pglite.query(
      "UPDATE calendar_invites SET last_method='cancel', sequence=9 WHERE ics_uid='dropped-invite@events.example.com'",
    );
    const token = await tokenFor(droppedSpeakerId);
    const body = await (await calendarFeedResponse(token.raw, { dbOrTx: tx, env, verify })).text();
    expect(body).toContain("STATUS:CANCELLED");
    expect(body).toContain("SEQUENCE:9");
    await pglite.query(
      "UPDATE calendar_invites SET last_method='request', sequence=2 WHERE ics_uid='dropped-invite@events.example.com'",
    );
  });

  it("returns a valid empty VCALENDAR for a speaker with no published sessions", async () => {
    const token = await tokenFor(emptySpeakerId);
    const response = await calendarFeedResponse(token.raw, { dbOrTx: tx, env, verify });
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("BEGIN:VCALENDAR\r\n");
    expect(body).toContain("X-WR-CALNAME:AI Engineer — Empty Speaker");
    expect(body).not.toContain("BEGIN:VEVENT");
    expect(body.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
});
