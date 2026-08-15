import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbOrTx } from "@/db/client";
import * as schema from "@/db/schema";
import { getPublishedScheduleIn, getPublishedSpeakersIn } from "@/features/public/server/public-queries";

function required<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) throw new Error(message);
  return value;
}

const migration0 = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");
// M50 is additive on top of the base schema; applying it keeps this fixture
// aligned with the columns the repository modules now read.
const migrationReviewOps = readFileSync(new URL("../../drizzle/0004_review_operations.sql", import.meta.url), "utf8");
const migrationPublicScheduleRevision = readFileSync(new URL("../../drizzle/0034_public_schedule_revision.sql", import.meta.url), "utf8");
// First Fair added `events.is_demo`, which `resolveEventBySlug` now names on
// every `select()` it runs — this fixture needs 0047 even though it never
// touches a demo event, the same reason `public-ics.test.ts` needed it. 0047
// also widens 0023's milestone CHECK (which itself needs organization tenancy
// for `organizations`' FK), so both of those have to be present too.
const migrationOrganizationTenancy = readFileSync(new URL("../../drizzle/0010_organization_tenancy.sql", import.meta.url), "utf8");
const migrationOnboardingMilestones = readFileSync(new URL("../../drizzle/0023_onboarding_milestones.sql", import.meta.url), "utf8");
const migrationSubmissionStatusViews = readFileSync(new URL("../../drizzle/0045_public_views_submission_status.sql", import.meta.url), "utf8");
const migrationDemoEvents = readFileSync(new URL("../../drizzle/0047_demo_events_and_tour.sql", import.meta.url), "utf8");

const eventId = "a1000000-0000-4000-8000-000000000001";
const otherEventId = "a1000000-0000-4000-8000-000000000002";
const eventSlug = "test-event";

const speakerConfirmed = "a1000000-0000-4000-8000-000000000020";
const speakerUnconfirmed = "a1000000-0000-4000-8000-000000000021";
const speakerDeclined = "a1000000-0000-4000-8000-000000000022";

const sessionDraft = "a1000000-0000-4000-8000-000000000030";
const sessionPublished = "a1000000-0000-4000-8000-000000000031";
const sessionUnconfirmedOnly = "a1000000-0000-4000-8000-000000000032";
const sessionDeclinedSpeaker = "a1000000-0000-4000-8000-000000000033";
const sessionOtherEvent = "a1000000-0000-4000-8000-000000000040";
const sessionFromAccepted = "a1000000-0000-4000-8000-000000000034";
const sessionFromDeclined = "a1000000-0000-4000-8000-000000000035";
const sessionFromWithdrawn = "a1000000-0000-4000-8000-000000000036";

const submissionAccepted = "a1000000-0000-4000-8000-000000000070";
const submissionDeclined = "a1000000-0000-4000-8000-000000000071";
const submissionWithdrawn = "a1000000-0000-4000-8000-000000000072";
const speakerReversed = "a1000000-0000-4000-8000-000000000023";

const headshotFileId = "a1000000-0000-4000-8000-000000000050";
const roomId = "a1000000-0000-4000-8000-000000000060";
const trackId = "a1000000-0000-4000-8000-000000000061";
const formatId = "a1000000-0000-4000-8000-000000000062";

let pglite: PGlite;
let db: DbOrTx;

describe("public schedule + speaker gallery published-view queries", () => {
  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migration0);
    await pglite.exec(migration1);
    await pglite.exec(migrationReviewOps);
    await pglite.exec(migrationPublicScheduleRevision);
    await pglite.exec(migrationOrganizationTenancy);
    await pglite.exec(migrationOnboardingMilestones);
    await pglite.exec(migrationSubmissionStatusViews);
    await pglite.exec(migrationDemoEvents);
    db = drizzle(pglite, { schema }) as unknown as DbOrTx;

    // PDT (UTC-7) in September: a session starting 2026-09-16T05:30:00Z is
    // 2026-09-15 22:30 local — a naive `.toISOString().slice(0, 10)` would
    // bin it under the wrong day tab.
    await pglite.query(
      "INSERT INTO events(id,name,slug,timezone,starts_at,ends_at,theme) VALUES($1,'Test Event','test-event','America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z','#4f46e5')",
      [eventId],
    );
    await pglite.query(
      "INSERT INTO events(id,name,slug,timezone,starts_at,ends_at) VALUES($1,'Other Event','other-event','America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
      [otherEventId],
    );

    await pglite.query("INSERT INTO file_assets(id,event_id,kind,r2_key,filename,mime) VALUES($1,$2,'headshot','staging/headshot.jpg','ada.jpg','image/jpeg')", [headshotFileId, eventId]);

    await pglite.query("INSERT INTO rooms(id,event_id,name) VALUES($1,$2,'Main Hall')", [roomId, eventId]);
    await pglite.query("INSERT INTO tracks(id,event_id,name,color) VALUES($1,$2,'AI Agents','#00a878')", [trackId, eventId]);
    await pglite.query("INSERT INTO session_formats(id,event_id,name) VALUES($1,$2,'Talk')", [formatId, eventId]);

    await pglite.query(
      "INSERT INTO contacts(id,event_id,email,first_name,last_name,confirmation_status,headshot_file_id) VALUES($1,$2,'confirmed@example.com','Ada','Lovelace','confirmed',$3)",
      [speakerConfirmed, eventId, headshotFileId],
    );
    await pglite.query(
      "INSERT INTO contacts(id,event_id,email,first_name,last_name,confirmation_status) VALUES($1,$2,'unconfirmed@example.com','Grace','Hopper','unconfirmed')",
      [speakerUnconfirmed, eventId],
    );
    await pglite.query(
      "INSERT INTO contacts(id,event_id,email,first_name,last_name,confirmation_status) VALUES($1,$2,'declined@example.com','Alan','Turing','declined')",
      [speakerDeclined, eventId],
    );

    await pglite.query(
      "INSERT INTO sessions(id,event_id,title,slug,description_html,starts_at,ends_at,status) VALUES($1,$2,'Draft Talk','draft-talk','<p>draft</p>','2026-09-15T17:00:00Z','2026-09-15T17:30:00Z','draft')",
      [sessionDraft, eventId],
    );
    await pglite.query(
      "INSERT INTO sessions(id,event_id,title,slug,description_html,starts_at,ends_at,status,room_id,track_id,format_id,schedule_revision) VALUES($1,$2,'Published Talk','published-talk','<p>published</p>','2026-09-16T05:30:00Z','2026-09-16T06:00:00Z','published',$3,$4,$5,3)",
      [sessionPublished, eventId, roomId, trackId, formatId],
    );
    await pglite.query(
      "INSERT INTO sessions(id,event_id,title,slug,starts_at,ends_at,status) VALUES($1,$2,'Unconfirmed-only Talk','unconfirmed-talk','2026-09-15T18:00:00Z','2026-09-15T18:30:00Z','published')",
      [sessionUnconfirmedOnly, eventId],
    );
    await pglite.query(
      "INSERT INTO sessions(id,event_id,title,slug,starts_at,ends_at,status) VALUES($1,$2,'Declined-speaker Talk','declined-talk','2026-09-15T19:00:00Z','2026-09-15T19:30:00Z','published')",
      [sessionDeclinedSpeaker, eventId],
    );
    await pglite.query(
      "INSERT INTO sessions(id,event_id,title,slug,starts_at,ends_at,status) VALUES($1,$2,'Other Event Talk','other-event-talk','2026-09-15T18:00:00Z','2026-09-15T18:30:00Z','published')",
      [sessionOtherEvent, otherEventId],
    );

    await pglite.query("INSERT INTO session_speakers(event_id,session_id,contact_id,sort_order) VALUES($1,$2,$3,0)", [eventId, sessionPublished, speakerConfirmed]);
    await pglite.query("INSERT INTO session_speakers(event_id,session_id,contact_id,sort_order) VALUES($1,$2,$3,0)", [eventId, sessionUnconfirmedOnly, speakerUnconfirmed]);
    await pglite.query("INSERT INTO session_speakers(event_id,session_id,contact_id,sort_order) VALUES($1,$2,$3,0)", [eventId, sessionDeclinedSpeaker, speakerDeclined]);
    // A promoted session per submission status. Only the accepted one may be
    // public: reversing a decision (declined) or a speaker withdrawing must
    // take the talk and its speaker off every public surface.
    await pglite.query(
      "INSERT INTO contacts(id,event_id,email,first_name,last_name,confirmation_status) VALUES($1,$2,'reversed@example.com','Reversed','Speaker','confirmed')",
      [speakerReversed, eventId],
    );
    for (const [submissionId, status] of [
      [submissionAccepted, "accepted"],
      [submissionDeclined, "declined"],
      [submissionWithdrawn, "withdrawn"],
    ] as const) {
      await pglite.query(
        "INSERT INTO submissions(id,event_id,code,status,title) VALUES($1,$2,$3,$4,'Promoted abstract')",
        [submissionId, eventId, Number(submissionId.slice(-3)), status],
      );
    }
    for (const [sessionId, submissionId, slug] of [
      [sessionFromAccepted, submissionAccepted, "accepted-abstract-talk"],
      [sessionFromDeclined, submissionDeclined, "declined-abstract-talk"],
      [sessionFromWithdrawn, submissionWithdrawn, "withdrawn-abstract-talk"],
    ] as const) {
      await pglite.query(
        "INSERT INTO sessions(id,event_id,submission_id,title,slug,starts_at,ends_at,status) VALUES($1,$2,$3,'Promoted Talk',$4,'2026-09-15T20:00:00Z','2026-09-15T20:30:00Z','published')",
        [sessionId, eventId, submissionId, slug],
      );
      await pglite.query("INSERT INTO session_speakers(event_id,session_id,contact_id,sort_order) VALUES($1,$2,$3,0)", [eventId, sessionId, speakerReversed]);
    }

    // The draft session also has the confirmed speaker attached — it must
    // still never surface, proving the leak firewall is the session's own
    // status, not merely "does this speaker ever appear published".
    await pglite.query("INSERT INTO session_speakers(event_id,session_id,contact_id,sort_order) VALUES($1,$2,$3,0)", [eventId, sessionDraft, speakerConfirmed]);
  });

  afterAll(async () => {
    await pglite.close();
  });

  it("returns null for an unknown slug instead of throwing", async () => {
    expect(await getPublishedScheduleIn(db, "no-such-event")).toBeNull();
    expect(await getPublishedSpeakersIn(db, "no-such-event")).toBeNull();
  });

  it("omits drafts and other events' sessions, and bins by the event's own timezone", async () => {
    const schedule = required(await getPublishedScheduleIn(db, eventSlug), "expected a schedule");
    const ids = schedule.sessions.map((s) => s.id);

    expect(ids).not.toContain(sessionDraft);
    expect(ids).not.toContain(sessionOtherEvent);
    expect(ids).toEqual(expect.arrayContaining([sessionPublished, sessionUnconfirmedOnly, sessionDeclinedSpeaker]));

    // 2026-09-16T05:30:00Z is 2026-09-15 local in America/Los_Angeles (PDT).
    const published = schedule.sessions.find((s) => s.id === sessionPublished);
    expect(published?.dayKey).toBe("2026-09-15");
    expect(published?.scheduleRevision).toBe(3);
    expect(schedule.days).toEqual(["2026-09-15"]);
  });

  it("returns speakers: [] for a published session whose sole speaker is unconfirmed, never an error", async () => {
    const schedule = required(await getPublishedScheduleIn(db, eventSlug), "expected a schedule");
    const session = schedule.sessions.find((s) => s.id === sessionUnconfirmedOnly);
    expect(session).toBeDefined();
    expect(session?.speakers).toEqual([]);
  });

  it("returns speakers: [] for a published session whose sole speaker was admin-declined", async () => {
    const schedule = required(await getPublishedScheduleIn(db, eventSlug), "expected a schedule");
    const session = schedule.sessions.find((s) => s.id === sessionDeclinedSpeaker);
    expect(session?.speakers).toEqual([]);
  });

  it("resolves a confirmed speaker's headshot through the public /f/ path", async () => {
    const schedule = required(await getPublishedScheduleIn(db, eventSlug), "expected a schedule");
    const session = schedule.sessions.find((s) => s.id === sessionPublished);
    expect(session?.speakers).toEqual([{
      contactId: speakerConfirmed, name: "Ada Lovelace", jobTitle: null, company: null, headshotUrl: `/f/${headshotFileId}`,
    }]);
  });

  it("getPublishedSpeakers never returns an unconfirmed or declined contact, even when they sit on a published session", async () => {
    const speakers = required(await getPublishedSpeakersIn(db, eventSlug), "expected speakers");
    const ids = speakers.speakers.map((s) => s.contactId);

    expect(ids).toEqual([speakerConfirmed, speakerReversed]);
    expect(ids).not.toContain(speakerUnconfirmed);
    expect(ids).not.toContain(speakerDeclined);
  });

  it("scopes a confirmed speaker's sessions[] to their own published talks", async () => {
    const speakers = required(await getPublishedSpeakersIn(db, eventSlug), "expected speakers");
    const ada = speakers.speakers.find((s) => s.contactId === speakerConfirmed);
    expect(ada?.sessions).toEqual([{
      id: sessionPublished, slug: "published-talk", title: "Published Talk",
      startsAt: "2026-09-16T05:30:00.000Z", endsAt: "2026-09-16T06:00:00.000Z", dayKey: "2026-09-15",
      room: { id: roomId, name: "Main Hall" },
      track: { id: trackId, name: "AI Agents", color: "#00a878" },
      format: { id: formatId, name: "Talk" },
    }]);
  });

  it("drops a published session whose abstract left accepted, and keeps agenda-native sessions", async () => {
    const schedule = required(await getPublishedScheduleIn(db, eventSlug), "expected a schedule");
    const ids = schedule.sessions.map((s) => s.id);

    expect(ids).toContain(sessionFromAccepted);
    expect(ids).not.toContain(sessionFromDeclined);
    expect(ids).not.toContain(sessionFromWithdrawn);
    // Keynotes and breaks are created straight in the agenda and carry no
    // submission at all; the guard must not take them down with the rest.
    expect(ids).toContain(sessionPublished);
  });

  it("keeps a reversed submission's session out of its speaker's public sessions[]", async () => {
    const speakers = required(await getPublishedSpeakersIn(db, eventSlug), "expected speakers");
    const reversed = speakers.speakers.find((s) => s.contactId === speakerReversed);
    // The same speaker sits on all three promoted sessions; only the one whose
    // abstract is still accepted may appear.
    expect(reversed?.sessions.map((session) => session.id)).toEqual([sessionFromAccepted]);
  });

  it("carries job title/company on session speaker references, and room/track/format on speaker session references", async () => {
    await pglite.query("UPDATE contacts SET job_title = 'Mathematician', company = 'Royal Society' WHERE id = $1", [speakerConfirmed]);
    const schedule = required(await getPublishedScheduleIn(db, eventSlug), "expected a schedule");
    const session = schedule.sessions.find((s) => s.id === sessionPublished);
    expect(session?.speakers[0]).toMatchObject({ jobTitle: "Mathematician", company: "Royal Society" });
    expect(session?.room).toEqual({ id: roomId, name: "Main Hall" });
    expect(session?.track).toEqual({ id: trackId, name: "AI Agents", color: "#00a878" });
    expect(session?.format).toEqual({ id: formatId, name: "Talk" });

    const speakers = required(await getPublishedSpeakersIn(db, eventSlug), "expected speakers");
    const ada = speakers.speakers.find((s) => s.contactId === speakerConfirmed);
    expect(ada?.sessions[0]).toMatchObject({ endsAt: "2026-09-16T06:00:00.000Z", room: { id: roomId, name: "Main Hall" } });
  });
});
