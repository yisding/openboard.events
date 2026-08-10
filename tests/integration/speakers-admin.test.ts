import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbOrTx } from "@/db/client";
import * as schema from "@/db/schema";
import {
  getOutstandingTasksViewIn,
  getSpeakerDetailIn,
  listContactsIn,
} from "@/features/portal/server/admin-speakers";
import { setConfirmationStatusIn, updateSpeakerEmailIn } from "@/features/portal/server/admin-speakers-mutations";
import { contactIdSchema, eventIdSchema, outstandingTasksRowSchema, submissionIdSchema } from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";

const migration0 = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");

const eventId = eventIdSchema.parse("b1000000-0000-4000-8000-000000000001");
const otherEventId = eventIdSchema.parse("b1000000-0000-4000-8000-000000000002");

// Ada: primary on an accepted submission, has a bio but no headshot.
const ada = contactIdSchema.parse("b1000000-0000-4000-8000-000000000010");
// Grace: co-speaker only on Ada's accepted submission — appears in
// `accepted_speakers_v` but owns zero submission-task assignments (the
// fan-out edge case the work order names explicitly).
const grace = contactIdSchema.parse("b1000000-0000-4000-8000-000000000011");
// Morgan: primary on a second accepted submission, profile fully filled in.
const morgan = contactIdSchema.parse("b1000000-0000-4000-8000-000000000012");
// A contact who never submitted anything — still listed, never an accepted
// speaker, no tasks.
const neverSubmitted = contactIdSchema.parse("b1000000-0000-4000-8000-000000000013");
const otherEventContact = contactIdSchema.parse("b1000000-0000-4000-8000-000000000020");

const talkOne = submissionIdSchema.parse("b1000000-0000-4000-8000-000000000030");
const talkTwo = submissionIdSchema.parse("b1000000-0000-4000-8000-000000000031");
const otherEventTalk = submissionIdSchema.parse("b1000000-0000-4000-8000-000000000032");

const headshotFileId = "b1000000-0000-4000-8000-000000000040";
const submissionTaskOne = "b1000000-0000-4000-8000-000000000050";
const submissionTaskTwo = "b1000000-0000-4000-8000-000000000051";

const publishedSession = "b1000000-0000-4000-8000-000000000060";

let pglite: PGlite;
let db: DbOrTx;

describe("speakers admin (M27) — list, detail and the two contact writes", () => {
  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migration0);
    await pglite.exec(migration1);
    db = drizzle(pglite, { schema }) as unknown as DbOrTx;

    await pglite.query(
      "INSERT INTO events(id,name,slug,timezone,starts_at,ends_at) VALUES($1,'Test Event','speakers-event','America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
      [eventId],
    );
    await pglite.query(
      "INSERT INTO events(id,name,slug,timezone,starts_at,ends_at) VALUES($1,'Other Event','other-speakers-event','America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
      [otherEventId],
    );

    await pglite.query(
      "INSERT INTO file_assets(id,event_id,kind,r2_key,filename,mime) VALUES($1,$2,'headshot','staging/headshot.jpg','morgan.jpg','image/jpeg')",
      [headshotFileId, eventId],
    );

    await pglite.query(
      "INSERT INTO contacts(id,event_id,email,first_name,last_name,bio_html,confirmation_status) VALUES($1,$2,'ada@example.com','Ada','Lovelace','<p>Writes programs.</p>','confirmed')",
      [ada, eventId],
    );
    await pglite.query(
      "INSERT INTO contacts(id,event_id,email,first_name,last_name,confirmation_status) VALUES($1,$2,'grace@example.com','Grace','Hopper','unconfirmed')",
      [grace, eventId],
    );
    await pglite.query(
      "INSERT INTO contacts(id,event_id,email,first_name,last_name,bio_html,headshot_file_id,confirmation_status) VALUES($1,$2,'morgan@example.com','Morgan','Freeman','<p>Narrates things.</p>',$3,'confirmed')",
      [morgan, eventId, headshotFileId],
    );
    await pglite.query(
      "INSERT INTO contacts(id,event_id,email,first_name,last_name,confirmation_status) VALUES($1,$2,'never@example.com','Never','Submitted','unconfirmed')",
      [neverSubmitted, eventId],
    );
    await pglite.query(
      "INSERT INTO contacts(id,event_id,email,first_name,last_name,confirmation_status) VALUES($1,$2,'other@example.com','Other','Event','confirmed')",
      [otherEventContact, otherEventId],
    );

    await pglite.query(
      "INSERT INTO submissions(id,event_id,code,title,status,submitted_at) VALUES($1,$2,1,'Caching at the edge','accepted', now())",
      [talkOne, eventId],
    );
    await pglite.query(
      "INSERT INTO submissions(id,event_id,code,title,status,submitted_at) VALUES($1,$2,2,'Agents that ship','accepted', now())",
      [talkTwo, eventId],
    );
    await pglite.query(
      "INSERT INTO submissions(id,event_id,code,title,status,submitted_at) VALUES($1,$2,1,'Elsewhere','accepted', now())",
      [otherEventTalk, otherEventId],
    );

    await pglite.query(
      "INSERT INTO submission_participants(event_id,submission_id,contact_id,is_primary,sort_order) VALUES($1,$2,$3,true,0)",
      [eventId, talkOne, ada],
    );
    await pglite.query(
      "INSERT INTO submission_participants(event_id,submission_id,contact_id,is_primary,sort_order) VALUES($1,$2,$3,false,1)",
      [eventId, talkOne, grace],
    );
    await pglite.query(
      "INSERT INTO submission_participants(event_id,submission_id,contact_id,is_primary,sort_order) VALUES($1,$2,$3,true,0)",
      [eventId, talkTwo, morgan],
    );
    await pglite.query(
      "INSERT INTO submission_participants(event_id,submission_id,contact_id,is_primary,sort_order) VALUES($1,$2,$3,true,0)",
      [otherEventId, otherEventTalk, otherEventContact],
    );

    // Submission-targeted tasks fan out to the primary contact of *every*
    // accepted submission (resolution #14) — not to one submission each — so
    // both Ada (primary on talkOne) and Morgan (primary on talkTwo) pick up
    // both tasks; Grace (co-speaker on talkOne, never primary) picks up
    // neither.
    await pglite.query(
      "INSERT INTO portal_tasks(id,event_id,name,target_type,completion_mode,due_at,sort_order) VALUES($1,$2,'Send final slides','submission','manual', now() - interval '1 day',0)",
      [submissionTaskOne, eventId],
    );
    await pglite.query(
      "INSERT INTO portal_tasks(id,event_id,name,target_type,completion_mode,due_at,sort_order) VALUES($1,$2,'Confirm AV needs','submission','manual', now() + interval '3 days',1)",
      [submissionTaskTwo, eventId],
    );
    // Ada already sent her AV needs in — completed on *her* assignment only
    // (scoped by submission_id), so Ada (1 open) and Morgan (2 open) sort
    // deterministically instead of tying.
    await pglite.query(
      "INSERT INTO task_completions(event_id,task_id,contact_id,submission_id,completed_via) VALUES($1,$2,$3,$4,'manual')",
      [eventId, submissionTaskTwo, ada, talkOne],
    );

    // A published, scheduled session for Ada — the fixture `setConfirmationStatus`
    // exercises against `published_speakers_v`.
    await pglite.query(
      "INSERT INTO sessions(id,event_id,submission_id,title,slug,starts_at,ends_at,status) VALUES($1,$2,$3,'Caching at the edge','caching-at-the-edge','2026-09-16T05:30:00Z','2026-09-16T06:00:00Z','published')",
      [publishedSession, eventId, talkOne],
    );
    await pglite.query("INSERT INTO session_speakers(event_id,session_id,contact_id,sort_order) VALUES($1,$2,$3,0)", [eventId, publishedSession, ada]);
  });

  afterAll(async () => {
    await pglite.close();
  });

  async function publishedSpeakerIds(): Promise<string[]> {
    const result = await pglite.query<{ contact_id: string }>(
      "SELECT contact_id FROM published_speakers_v WHERE event_id = $1",
      [eventId],
    );
    return result.rows.map((row) => row.contact_id);
  }

  describe("listContacts", () => {
    it("matches missing_assets_v for missing=either — Ada (no headshot) and Grace (neither) qualify, Morgan and the never-submitted contact do not", async () => {
      const { rows, total } = await listContactsIn(db, eventId, { missing: "either" });
      const ids = rows.map((row) => row.contactId).sort();
      expect(ids).toEqual([ada, grace].sort());
      expect(total).toBe(2);
    });

    it("missing=bio isolates the contact with no bio at all", async () => {
      const { rows } = await listContactsIn(db, eventId, { missing: "bio" });
      expect(rows.map((row) => row.contactId)).toEqual([grace]);
    });

    it("missing=headshot includes anyone without one, bio or not", async () => {
      const { rows } = await listContactsIn(db, eventId, { missing: "headshot" });
      expect(rows.map((row) => row.contactId).sort()).toEqual([ada, grace].sort());
    });

    it("accepted=true excludes the contact with no submissions", async () => {
      const { rows } = await listContactsIn(db, eventId, { accepted: true });
      const ids = rows.map((row) => row.contactId);
      expect(ids).toContain(ada);
      expect(ids).toContain(grace);
      expect(ids).toContain(morgan);
      expect(ids).not.toContain(neverSubmitted);
    });

    it("q matches name and email, case-insensitively", async () => {
      const { rows } = await listContactsIn(db, eventId, { q: "ADA" });
      expect(rows.map((row) => row.contactId)).toEqual([ada]);
    });

    it("the co-speaker-only edge case reports 0 open / 0 overdue honestly, not as a missing value", async () => {
      const { rows } = await listContactsIn(db, eventId, { q: "grace" });
      expect(rows[0]).toMatchObject({ isAcceptedSpeaker: true, openTasks: 0, overdueTasks: 0, submissionCount: 1 });
    });

    it("never leaks another event's contacts into the count or the rows", async () => {
      const { rows, total } = await listContactsIn(db, eventId, {});
      expect(rows.some((row) => row.contactId === otherEventContact)).toBe(false);
      expect(total).toBe(4);
    });

    it("sorts by openTasks, nulls (never-assigned contacts) last in either direction", async () => {
      // Morgan (2 open) outranks Ada (1 open — she already completed one);
      // Grace and the never-submitted contact have no `speaker_outstanding_v`
      // row at all (a true SQL null, not a real zero), and sit last either way.
      const desc = await listContactsIn(db, eventId, { sort: "openTasks", dir: "desc" });
      expect(desc.rows.map((row) => row.contactId)).toEqual([morgan, ada, grace, neverSubmitted]);

      const asc = await listContactsIn(db, eventId, { sort: "openTasks", dir: "asc" });
      expect(asc.rows.map((row) => row.contactId)).toEqual([ada, morgan, grace, neverSubmitted]);
    });
  });

  describe("getSpeakerDetail", () => {
    it("returns submissions, tasks (one completed, one overdue) and an empty comms list for a fully-fledged speaker", async () => {
      const detail = await getSpeakerDetailIn(db, eventId, ada);
      expect(detail).not.toBeNull();
      expect(detail?.submissions).toHaveLength(1);
      expect(detail?.submissions[0]).toMatchObject({ code: 1, portalStatus: "accepted", isPrimary: true });
      expect(detail?.tasks).toHaveLength(2);
      expect(detail?.tasks.find((task) => task.name === "Send final slides")).toMatchObject({ completed: false, overdue: true });
      expect(detail?.tasks.find((task) => task.name === "Confirm AV needs")).toMatchObject({ completed: true, overdue: false });
      expect(detail?.comms).toEqual([]);
    });

    it("shows the co-speaker-only contact with a real submission but zero task rows, not an error", async () => {
      const detail = await getSpeakerDetailIn(db, eventId, grace);
      expect(detail?.submissions).toHaveLength(1);
      expect(detail?.tasks).toEqual([]);
      expect(detail?.contact.isAcceptedSpeaker).toBe(true);
    });

    it("shows the never-submitted contact with empty submissions and tasks, not an error", async () => {
      const detail = await getSpeakerDetailIn(db, eventId, neverSubmitted);
      expect(detail?.submissions).toEqual([]);
      expect(detail?.tasks).toEqual([]);
      expect(detail?.contact.isAcceptedSpeaker).toBe(false);
    });

    it("returns null for a contact id scoped to another event (R4 — never another event's row)", async () => {
      const detail = await getSpeakerDetailIn(db, eventId, otherEventContact);
      expect(detail).toBeNull();
    });
  });

  describe("updateSpeakerEmail", () => {
    it("normalizes and writes only the email column", async () => {
      await updateSpeakerEmailIn(db, eventId, neverSubmitted, "  Never+New@Example.com  ");
      const detail = await getSpeakerDetailIn(db, eventId, neverSubmitted);
      expect(detail?.contact.email).toBe("never+new@example.com");
      // First/last name untouched by an email-only write.
      const raw = await pglite.query<{ first_name: string }>("SELECT first_name FROM contacts WHERE id = $1", [neverSubmitted]);
      expect(raw.rows[0]?.first_name).toBe("Never");
    });

    it("maps a same-event collision to a friendly CONFLICT error and leaves the row untouched", async () => {
      await expect(updateSpeakerEmailIn(db, eventId, morgan, "ada@example.com")).rejects.toSatisfy((error: unknown) => {
        return isAppError(error) && error.code === "CONFLICT" && error.message.includes("already uses that address");
      });
      const raw = await pglite.query<{ email: string }>("SELECT email FROM contacts WHERE id = $1", [morgan]);
      expect(raw.rows[0]?.email).toBe("morgan@example.com");
    });
  });

  describe("getOutstandingTasksView", () => {
    it("returns contract-shaped rows off speaker_outstanding_v, ordered by open then overdue", async () => {
      const rows = await getOutstandingTasksViewIn(db, eventId);
      // Every row parses as the frozen contract — including `doneCount`,
      // which the /api/v1 projection drops.
      for (const row of rows) expect(() => outstandingTasksRowSchema.parse(row)).not.toThrow();
      // Morgan owns both submission tasks and has finished neither; Ada owns
      // both but completed one, so she sorts second on open count.
      expect(rows.map((row) => row.contactId)).toEqual([morgan, ada]);
      expect(rows[0]).toMatchObject({ contactId: morgan, openCount: 2, overdueCount: 1, doneCount: 0 });
      expect(rows[1]).toMatchObject({ contactId: ada, openCount: 1, overdueCount: 1, doneCount: 1 });
    });

    it("omits the co-speaker with no assignments and never crosses the event boundary", async () => {
      const rows = await getOutstandingTasksViewIn(db, eventId);
      expect(rows.some((row) => row.contactId === grace)).toBe(false);
      expect(rows.some((row) => row.contactId === neverSubmitted)).toBe(false);
      expect(rows.some((row) => row.contactId === otherEventContact)).toBe(false);
      expect(await getOutstandingTasksViewIn(db, otherEventId)).toEqual([]);
    });
  });

  describe("setConfirmationStatus", () => {
    it("declining a confirmed speaker removes them from published_speakers_v; re-confirming restores them", async () => {
      expect(await publishedSpeakerIds()).toContain(ada);

      await setConfirmationStatusIn(db, eventId, ada, "declined");
      expect(await publishedSpeakerIds()).not.toContain(ada);

      await setConfirmationStatusIn(db, eventId, ada, "confirmed");
      expect(await publishedSpeakerIds()).toContain(ada);
    });
  });
});
