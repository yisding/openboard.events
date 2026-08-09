import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbOrTx } from "@/db/client";
import * as schema from "@/db/schema";
import { countMySubmissionsIn, getMySubmissionIn, listMySubmissionsIn } from "@/features/portal";
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
    expect(rows[0]?.status).toBe("accepted");
    expect(await countMySubmissionsIn(db, eventA, speaker)).toBe(1);
  });

  it("returns statuses raw, leaving the queue collapse to the one portal mapping", async () => {
    await pglite.query("UPDATE submissions SET status='accept_queue' WHERE id=$1", [shared]);
    const rows = await listMySubmissionsIn(db, eventA, speaker);
    expect(rows[0]?.status).toBe("accept_queue");
    await pglite.query("UPDATE submissions SET status='accepted' WHERE id=$1", [shared]);
  });

  it("reads a submission the speaker is on, with its co-speakers primary-first", async () => {
    const detail = await getMySubmissionIn(db, eventA, speaker, shared);
    expect(detail?.title).toBe("Shared talk");
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

  it("returns nothing for a contact with no submissions", async () => {
    expect(await listMySubmissionsIn(db, eventA, otherEventContact)).toEqual([]);
    expect(await countMySubmissionsIn(db, eventA, otherEventContact)).toBe(0);
  });
});
