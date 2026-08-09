import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbOrTx } from "@/db/client";
import * as schema from "@/db/schema";
import { countMySubmissionsIn, getMySubmissionIn, getMyTaskSummaryIn, listMySubmissionsIn } from "@/features/portal";
import { contactIdSchema, eventIdSchema } from "@/shared/contracts";

const migration0 = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");

const eventA = eventIdSchema.parse("c0000000-0000-4000-8000-000000000001");
const eventB = eventIdSchema.parse("c0000000-0000-4000-8000-000000000002");
const speaker = contactIdSchema.parse("c0000000-0000-4000-8000-000000000010");
const coSpeaker = contactIdSchema.parse("c0000000-0000-4000-8000-000000000011");
const stranger = contactIdSchema.parse("c0000000-0000-4000-8000-000000000012");
const otherEventContact = contactIdSchema.parse("c0000000-0000-4000-8000-000000000013");

const shared = "c0000000-0000-4000-8000-000000000020";
const soloOfStranger = "c0000000-0000-4000-8000-000000000021";
const inOtherEvent = "c0000000-0000-4000-8000-000000000022";

describe("portal submission queries", () => {
  let pglite: PGlite;
  let db: DbOrTx;

  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migration0);
    await pglite.exec(migration1);
    db = drizzle(pglite, { schema }) as unknown as DbOrTx;

    for (const [id, slug] of [[eventA, "event-a"], [eventB, "event-b"]] as const) {
      await pglite.query(
        "INSERT INTO events(id,name,slug,starts_at,ends_at) VALUES($1,$2,$3,'2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
        [id, `Event ${slug}`, slug],
      );
    }
    for (const [id, eventId, email] of [
      [speaker, eventA, "speaker@example.com"],
      [coSpeaker, eventA, "co@example.com"],
      [stranger, eventA, "stranger@example.com"],
      [otherEventContact, eventB, "speaker@example.com"],
    ] as const) {
      await pglite.query(
        "INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES($1,$2,$3,'Test','Person')",
        [id, eventId, email],
      );
    }

    // The speaker is a co-speaker on `shared`; `soloOfStranger` belongs to
    // somebody else in the same event; `inOtherEvent` is a same-email contact's
    // submission in another event.
    await pglite.query("INSERT INTO submissions(id,event_id,code,status,source,title) VALUES($1,$2,401,'accepted','cfp','Shared talk')", [shared, eventA]);
    await pglite.query("INSERT INTO submissions(id,event_id,code,status,source,title) VALUES($1,$2,402,'pending','cfp','Not yours')", [soloOfStranger, eventA]);
    await pglite.query("INSERT INTO submissions(id,event_id,code,status,source,title) VALUES($1,$2,403,'pending','cfp','Other event')", [inOtherEvent, eventB]);

    await pglite.query("INSERT INTO submission_participants(event_id,submission_id,contact_id,is_primary,sort_order) VALUES($1,$2,$3,true,0)", [eventA, shared, coSpeaker]);
    await pglite.query("INSERT INTO submission_participants(event_id,submission_id,contact_id,is_primary,sort_order) VALUES($1,$2,$3,false,1)", [eventA, shared, speaker]);
    await pglite.query("INSERT INTO submission_participants(event_id,submission_id,contact_id,is_primary,sort_order) VALUES($1,$2,$3,true,0)", [eventA, soloOfStranger, stranger]);
    await pglite.query("INSERT INTO submission_participants(event_id,submission_id,contact_id,is_primary,sort_order) VALUES($1,$2,$3,true,0)", [eventB, inOtherEvent, otherEventContact]);
  }, 60_000);

  afterAll(async () => {
    await pglite.close();
  });

  it("lists only the submissions the speaker is on", async () => {
    const rows = await listMySubmissionsIn(db, eventA, speaker);
    expect(rows.map((row) => row.submissionId)).toEqual([shared]);
    expect(rows[0]?.isPrimary).toBe(false);
    expect(rows[0]?.status).toBe("Accepted");
    expect(await countMySubmissionsIn(db, eventA, speaker)).toBe(1);
  });

  it("never lets a queue state reach the speaker", async () => {
    // The leak this closes: a speaker reading accept_queue in a response knows
    // their decision days before the organizer sends it.
    for (const queued of ["accept_queue", "decline_queue"] as const) {
      await pglite.query("UPDATE submissions SET status=$1 WHERE id=$2", [queued, shared]);
      expect((await listMySubmissionsIn(db, eventA, speaker))[0]?.status).toBe("Pending");
      expect((await getMySubmissionIn(db, eventA, speaker, shared))?.status).toBe("Pending");
    }
    await pglite.query("UPDATE submissions SET status='accepted' WHERE id=$1", [shared]);
  });

  it("orders submitted proposals ahead of drafts, whatever was edited last", async () => {
    const draft = "c0000000-0000-4000-8000-000000000023";
    await pglite.query(
      "INSERT INTO submissions(id,event_id,code,status,source,title,updated_at) VALUES($1,$2,404,'draft','cfp','A draft edited just now', now())",
      [draft, eventA],
    );
    await pglite.query("INSERT INTO submission_participants(event_id,submission_id,contact_id,is_primary,sort_order) VALUES($1,$2,$3,true,0)", [eventA, draft, speaker]);
    await pglite.query("UPDATE submissions SET submitted_at = now() - interval '3 days', updated_at = now() - interval '3 days' WHERE id=$1", [shared]);

    const rows = await listMySubmissionsIn(db, eventA, speaker);
    expect(rows.map((row) => row.submissionId)).toEqual([shared, draft]);

    await pglite.query("DELETE FROM submissions WHERE id=$1", [draft]);
  });

  it("resolves the organizer's vocabulary rather than raw ids", async () => {
    const track = "c0000000-0000-4000-8000-000000000030";
    const format = "c0000000-0000-4000-8000-000000000031";
    await pglite.query("INSERT INTO tracks(id,event_id,name,color) VALUES($1,$2,'Agents','#6958d7')", [track, eventA]);
    await pglite.query("INSERT INTO session_formats(id,event_id,name) VALUES($1,$2,'Workshop')", [format, eventA]);
    await pglite.query("UPDATE submissions SET track_id=$1, format_id=$2 WHERE id=$3", [track, format, shared]);

    const [row] = await listMySubmissionsIn(db, eventA, speaker);
    expect(row?.trackName).toBe("Agents");
    expect(row?.trackColor).toBe("#6958d7");
    expect(row?.formatName).toBe("Workshop");

    // An unrouted submission has no track, and a null must not become "null".
    await pglite.query("UPDATE submissions SET track_id=NULL, format_id=NULL WHERE id=$1", [shared]);
    expect((await listMySubmissionsIn(db, eventA, speaker))[0]?.trackName).toBeNull();
    await pglite.query("UPDATE submissions SET track_id=$1, format_id=$2 WHERE id=$3", [track, format, shared]);
  });

  it("reads a submission the speaker is on, with its co-speakers primary-first", async () => {
    const detail = await getMySubmissionIn(db, eventA, speaker, shared);
    expect(detail?.title).toBe("Shared talk");
    expect(detail?.trackName).toBe("Agents");
    expect(detail?.participants.map((participant) => participant.email)).toEqual(["co@example.com", "speaker@example.com"]);
    expect(detail?.participants[0]?.isPrimary).toBe(true);
  });

  it("hides a submission in the same event the speaker is not on", async () => {
    // Null, not an error: "exists but not yours" and "does not exist" must be
    // indistinguishable to someone probing ids.
    expect(await getMySubmissionIn(db, eventA, speaker, soloOfStranger)).toBeNull();
  });

  it("refuses to cross events even for the same email", async () => {
    expect(await getMySubmissionIn(db, eventA, speaker, inOtherEvent)).toBeNull();
    expect(await getMySubmissionIn(db, eventB, speaker, inOtherEvent)).toBeNull();
    expect(await listMySubmissionsIn(db, eventB, speaker)).toEqual([]);
  });

  it("reads task counts from the view, and zero when there are no assignments", async () => {
    // No assignments is zero, not an absent row the caller has to interpret.
    expect(await getMyTaskSummaryIn(db, eventA, speaker)).toEqual({ open: 0, overdue: 0, done: 0 });

    // accepted_speakers_v drives contact-targeted assignment, so an accepted
    // submission plus an active task is what makes one appear.
    const task = "c0000000-0000-4000-8000-000000000040";
    await pglite.query(
      "INSERT INTO portal_tasks(id,event_id,name,target_type,completion_mode,due_at) VALUES($1,$2,'Confirm details','contact','manual', now() - interval '2 days')",
      [task, eventA],
    );
    const summary = await getMyTaskSummaryIn(db, eventA, speaker);
    expect(summary.open).toBe(1);
    expect(summary.overdue).toBe(1);
    expect(summary.done).toBe(0);

    await pglite.query("DELETE FROM portal_tasks WHERE id=$1", [task]);
  });

  it("returns nothing for a contact with no submissions", async () => {
    expect(await listMySubmissionsIn(db, eventA, otherEventContact)).toEqual([]);
    expect(await countMySubmissionsIn(db, eventA, otherEventContact)).toBe(0);
  });
});
