import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contactIdSchema, eventIdSchema } from "@/shared/contracts";
import { getSpeakerShareDataIn, signSpeakerShareToken, verifySpeakerShareToken } from "./share";

const migration0 = readFileSync(new URL("../../../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");

const EVENT = eventIdSchema.parse("d0000000-0000-4000-8000-000000000001");
const SPEAKER_WITH_SCHEDULE = contactIdSchema.parse("d0000000-0000-4000-8000-000000000010");
const SPEAKER_UNPUBLISHED = contactIdSchema.parse("d0000000-0000-4000-8000-000000000011");
const SPEAKER_NOT_ACCEPTED = contactIdSchema.parse("d0000000-0000-4000-8000-000000000012");
const SECRET = "a".repeat(32);

let pg: PGlite;

describe("speaker share data", () => {
  beforeAll(async () => {
    pg = new PGlite();
    await pg.exec(migration0);
    await pg.exec(migration1);

    await pg.query(
      `INSERT INTO events(id,name,slug,timezone,starts_at,ends_at) VALUES ($1,'ShareConf','share-conf','America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')`,
      [EVENT],
    );
    await pg.query(
      `INSERT INTO file_assets(id,event_id,kind,r2_key,filename,mime) VALUES ('d0000000-0000-4000-8000-0000000000f1',$1,'headshot','headshots/ada.jpg','ada.jpg','image/jpeg')`,
      [EVENT],
    );
    await pg.query(
      `INSERT INTO contacts(id,event_id,email,first_name,last_name,headshot_file_id) VALUES
        ($1,$4,'ada@example.com','Ada','Lovelace','d0000000-0000-4000-8000-0000000000f1'),
        ($2,$4,'grace@example.com','Grace','Hopper',NULL),
        ($3,$4,'not-accepted@example.com','Not','Accepted',NULL)`,
      [SPEAKER_WITH_SCHEDULE, SPEAKER_UNPUBLISHED, SPEAKER_NOT_ACCEPTED, EVENT],
    );
    await pg.query(
      `INSERT INTO submissions(id,event_id,code,status,source,title) VALUES
        ('d0000000-0000-4000-8000-000000000020',$1,10,'accepted','cfp','Talk With A Published Slot'),
        ('d0000000-0000-4000-8000-000000000021',$1,11,'accepted','cfp','Talk Still Being Scheduled'),
        ('d0000000-0000-4000-8000-000000000022',$1,12,'pending','cfp','Not decided yet')`,
      [EVENT],
    );
    await pg.query(
      `INSERT INTO submission_participants(event_id,submission_id,contact_id,is_primary,sort_order) VALUES
        ($1,'d0000000-0000-4000-8000-000000000020',$2,true,0),
        ($1,'d0000000-0000-4000-8000-000000000021',$3,true,0),
        ($1,'d0000000-0000-4000-8000-000000000022',$4,true,0)`,
      [EVENT, SPEAKER_WITH_SCHEDULE, SPEAKER_UNPUBLISHED, SPEAKER_NOT_ACCEPTED],
    );
    await pg.query(
      `INSERT INTO rooms(id,event_id,name) VALUES ('d0000000-0000-4000-8000-000000000030',$1,'Main Hall')`,
      [EVENT],
    );
    // Published: the share page should show it. Draft: it should not, even
    // though the row already carries times an organizer is still drafting.
    await pg.query(
      `INSERT INTO sessions(id,event_id,submission_id,title,slug,status,room_id,starts_at,ends_at) VALUES
        ('d0000000-0000-4000-8000-000000000040',$1,'d0000000-0000-4000-8000-000000000020','Talk With A Published Slot','talk-with-a-published-slot','published','d0000000-0000-4000-8000-000000000030','2026-09-16T17:00:00Z','2026-09-16T17:30:00Z'),
        ('d0000000-0000-4000-8000-000000000041',$1,'d0000000-0000-4000-8000-000000000021','Talk Still Being Scheduled','talk-still-being-scheduled','draft',NULL,'2026-09-16T18:00:00Z','2026-09-16T18:30:00Z')`,
      [EVENT],
    );
  });

  afterAll(async () => {
    await pg.close();
  });

  it("composes from the accepted submission and contact, with a published schedule", async () => {
    const db = drizzle(pg);
    const data = await getSpeakerShareDataIn(db, EVENT, SPEAKER_WITH_SCHEDULE);
    expect(data).toEqual({
      eventName: "ShareConf",
      eventSlug: "share-conf",
      eventTimezone: "America/Los_Angeles",
      speakerName: "Ada Lovelace",
      headshotUrl: "/f/d0000000-0000-4000-8000-0000000000f1",
      submissionCode: 10,
      submissionTitle: "Talk With A Published Slot",
      schedule: { startsAt: "2026-09-16T17:00:00.000Z", endsAt: "2026-09-16T17:30:00.000Z", roomName: "Main Hall" },
    });
  });

  it("omits schedule details until the session is published, even with times already set", async () => {
    const db = drizzle(pg);
    const data = await getSpeakerShareDataIn(db, EVENT, SPEAKER_UNPUBLISHED);
    expect(data?.schedule).toBeNull();
    expect(data?.submissionTitle).toBe("Talk Still Being Scheduled");
  });

  it("returns null for a contact with no accepted submission", async () => {
    const db = drizzle(pg);
    expect(await getSpeakerShareDataIn(db, EVENT, SPEAKER_NOT_ACCEPTED)).toBeNull();
  });

  it("round-trips a signed token and rejects a tampered one", async () => {
    const token = await signSpeakerShareToken({ eventId: EVENT, contactId: SPEAKER_WITH_SCHEDULE }, SECRET);
    const claims = await verifySpeakerShareToken(token, SECRET);
    expect(claims).toEqual({ purpose: "speaker_share", eventId: EVENT, contactId: SPEAKER_WITH_SCHEDULE });
    expect(await verifySpeakerShareToken(`${token}x`, SECRET)).toBeNull();
    expect(await verifySpeakerShareToken(token, "b".repeat(32))).toBeNull();
  });
});
