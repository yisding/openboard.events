import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const base = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
const cancellationSnapshots = readFileSync(new URL("../../drizzle/0043_calendar_cancellation_snapshots.sql", import.meta.url), "utf8");

const eventId = "ca000000-0000-4000-8000-000000000001";
const contactId = "ca000000-0000-4000-8000-000000000002";
const sessionId = "ca000000-0000-4000-8000-000000000003";

describe("calendar cancellation snapshot migration", () => {
  let database: PGlite | undefined;

  afterEach(async () => database?.close());

  it("backfills legacy invite state, including an already-unscheduled session", async () => {
    database = new PGlite();
    await database.exec(base);
    await database.query(
      `INSERT INTO events(id,name,slug,location,timezone,starts_at,ends_at)
       VALUES($1,'Migration Event','migration-event','Pier 9','America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')`,
      [eventId],
    );
    await database.query(
      `INSERT INTO contacts(id,event_id,email,first_name,last_name)
       VALUES($1,$2,'legacy@example.com','Legacy','Speaker')`,
      [contactId, eventId],
    );
    // This models a REQUEST prepared before migration 0043 and a subsequent
    // unschedule that left the legacy invite row without the original times.
    await database.query(
      `INSERT INTO sessions(id,event_id,title,slug,starts_at,ends_at,status)
       VALUES($1,$2,'Legacy Session','legacy-session',NULL,NULL,'published')`,
      [sessionId, eventId],
    );
    await database.query(
      `INSERT INTO calendar_invites(event_id,contact_id,session_id,ics_uid,sequence,last_method,organizer_email)
       VALUES($1,$2,$3,'legacy-invite@example.com',4,'request','hello@mail.example.com')`,
      [eventId, contactId, sessionId],
    );

    await database.exec(cancellationSnapshots);

    const result = await database.query<{
      title: string; starts_at: string; ends_at: string; attendee_email: string;
    }>(`SELECT event_snapshot->>'title' AS title,
              event_snapshot->>'startsAt' AS starts_at,
              event_snapshot->>'endsAt' AS ends_at,
              event_snapshot->>'attendeeEmail' AS attendee_email
        FROM calendar_invites`);
    expect(result.rows[0]).toMatchObject({
      title: "Legacy Session",
      attendee_email: "legacy@example.com",
    });
    expect(Date.parse(result.rows[0]?.starts_at ?? "")).toBe(Date.parse("2026-09-15T16:00:00Z"));
    expect(Date.parse(result.rows[0]?.ends_at ?? "")).toBe(Date.parse("2026-09-17T01:00:00Z"));

    await expect(database.query(
      "UPDATE calendar_invites SET event_snapshot=NULL WHERE session_id=$1",
      [sessionId],
    )).rejects.toMatchObject({ code: "23502" });
  });
});
