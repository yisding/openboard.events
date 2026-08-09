import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SUBMISSION_STATUSES, canTransition } from "@/shared/contracts";

const migration0 = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");

let db: PGlite;

async function insertEvent(id: string, slug: string) {
  await db.query("INSERT INTO events(id,name,slug,starts_at,ends_at) VALUES($1,$2,$3,'2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')", [id, slug, slug]);
}

async function insertContact(id: string, eventId: string, email: string, confirmation = "unconfirmed") {
  await db.query("INSERT INTO contacts(id,event_id,email,first_name,last_name,confirmation_status) VALUES($1,$2,$3,'Test','Speaker',$4)", [id, eventId, email, confirmation]);
}

describe("database invariants", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(migration0);
    await db.exec(migration1);
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  it("applies the full schema and exposes exactly eight read views", async () => {
    const tables = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'");
    const views = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM information_schema.views WHERE table_schema='public' AND table_name LIKE '%_v'");
    expect(tables.rows[0]?.n).toBeGreaterThanOrEqual(30);
    expect(views.rows[0]?.n).toBe(8);
  });

  it("keeps the TypeScript and trigger transition matrices in parity", async () => {
    const eventId = "10000000-0000-4000-8000-000000000001";
    await insertEvent(eventId, "transition-event");
    for (const [fromIndex, from] of SUBMISSION_STATUSES.entries()) {
      for (const [toIndex, to] of SUBMISSION_STATUSES.entries()) {
        const id = `10000000-0000-4000-8${String(fromIndex).padStart(3, "0")}-${String(toIndex + 1).padStart(12, "0")}`;
        await db.query("INSERT INTO submissions(id,event_id,code,status,source) VALUES($1,$2,$3,$4,'manual')", [id, eventId, fromIndex * 10 + toIndex + 1, from]);
        let succeeded = true;
        try {
          await db.query("UPDATE submissions SET status=$1 WHERE id=$2", [to, id]);
        } catch {
          succeeded = false;
        }
        expect(succeeded, `${from} -> ${to}`).toBe(canTransition(from, to));
        await db.query("DELETE FROM submissions WHERE id=$1", [id]);
      }
    }
  });

  it("raises SQLSTATE 23514 for an illegal transition", async () => {
    const eventId = "20000000-0000-4000-8000-000000000001";
    const submissionId = "20000000-0000-4000-8000-000000000002";
    await insertEvent(eventId, "illegal-transition");
    await db.query("INSERT INTO submissions(id,event_id,code,status,source) VALUES($1,$2,1,'draft','manual')", [submissionId, eventId]);
    await expect(db.query("UPDATE submissions SET status='accepted' WHERE id=$1", [submissionId])).rejects.toMatchObject({ code: "23514" });
  });

  it("atomically clears notification state and bumps the revision on undo", async () => {
    const eventId = "30000000-0000-4000-8000-000000000001";
    const submissionId = "30000000-0000-4000-8000-000000000002";
    await insertEvent(eventId, "decision-undo");
    await db.query("INSERT INTO submissions(id,event_id,code,status,source,notified_at,notify_revision) VALUES($1,$2,1,'accepted','manual',now(),4)", [submissionId, eventId]);
    const result = await db.query<{ notified_at: string | null; notify_revision: number; row_version: number }>("UPDATE submissions SET status='pending' WHERE id=$1 RETURNING notified_at,notify_revision,row_version", [submissionId]);
    expect(result.rows[0]).toMatchObject({ notified_at: null, notify_revision: 5, row_version: 2 });
  });

  it("rejects a cross-event composite reference", async () => {
    const eventA = "40000000-0000-4000-8000-000000000001";
    const eventB = "40000000-0000-4000-8000-000000000002";
    const trackB = "40000000-0000-4000-8000-000000000003";
    await insertEvent(eventA, "event-a");
    await insertEvent(eventB, "event-b");
    await db.query("INSERT INTO tracks(id,event_id,name) VALUES($1,$2,'Other track')", [trackB, eventB]);
    await expect(db.query("INSERT INTO submissions(event_id,code,status,source,track_id) VALUES($1,1,'draft','manual',$2)", [eventA, trackB])).rejects.toMatchObject({ code: "23503" });
  });

  it("enforces NULLS NOT DISTINCT answer uniqueness", async () => {
    const eventId = "50000000-0000-4000-8000-000000000001";
    const formId = "50000000-0000-4000-8000-000000000002";
    const sectionId = "50000000-0000-4000-8000-000000000003";
    const fieldId = "50000000-0000-4000-8000-000000000004";
    const submissionId = "50000000-0000-4000-8000-000000000005";
    await insertEvent(eventId, "answer-unique");
    await db.query("INSERT INTO forms(id,event_id,context,internal_name) VALUES($1,$2,'cfp','Form')", [formId, eventId]);
    await db.query("INSERT INTO form_sections(id,event_id,form_id,key) VALUES($1,$2,$3,'abstract')", [sectionId, eventId, formId]);
    await db.query("INSERT INTO form_fields(id,event_id,form_id,section_id,key,label,field_type) VALUES($1,$2,$3,$4,'title','Title','text')", [fieldId, eventId, formId, sectionId]);
    await db.query("INSERT INTO submissions(id,event_id,form_id,form_version,code,status) VALUES($1,$2,$3,1,1,'pending')", [submissionId, eventId, formId]);
    await db.query("INSERT INTO submission_answers(event_id,submission_id,field_id,participant_id,value) VALUES($1,$2,$3,NULL,'{\"t\":\"s\",\"v\":\"one\"}')", [eventId, submissionId, fieldId]);
    await expect(db.query("INSERT INTO submission_answers(event_id,submission_id,field_id,participant_id,value) VALUES($1,$2,$3,NULL,'{\"t\":\"s\",\"v\":\"two\"}')", [eventId, submissionId, fieldId])).rejects.toMatchObject({ code: "23505" });
  });

  it("allows one draft but permits a submitted row beside it", async () => {
    const eventId = "60000000-0000-4000-8000-000000000001";
    const formId = "60000000-0000-4000-8000-000000000002";
    const contactId = "60000000-0000-4000-8000-000000000003";
    await insertEvent(eventId, "draft-unique");
    await insertContact(contactId, eventId, "draft@example.com");
    await db.query("INSERT INTO forms(id,event_id,context,internal_name) VALUES($1,$2,'cfp','Form')", [formId, eventId]);
    await db.query("INSERT INTO submissions(event_id,form_id,form_version,code,status,submitter_contact_id) VALUES($1,$2,1,1,'draft',$3)", [eventId, formId, contactId]);
    await expect(db.query("INSERT INTO submissions(event_id,form_id,form_version,code,status,submitter_contact_id) VALUES($1,$2,1,2,'draft',$3)", [eventId, formId, contactId])).rejects.toMatchObject({ code: "23505" });
    await expect(db.query("INSERT INTO submissions(event_id,form_id,form_version,code,status,submitter_contact_id) VALUES($1,$2,1,3,'pending',$3)", [eventId, formId, contactId])).resolves.toBeDefined();
  });

  it("fans a submission task out to its primary contact exactly once", async () => {
    const eventId = "70000000-0000-4000-8000-000000000001";
    const primary = "70000000-0000-4000-8000-000000000002";
    const coSpeaker = "70000000-0000-4000-8000-000000000003";
    const submissionId = "70000000-0000-4000-8000-000000000004";
    const taskId = "70000000-0000-4000-8000-000000000005";
    await insertEvent(eventId, "fanout-event");
    await insertContact(primary, eventId, "primary@example.com");
    await insertContact(coSpeaker, eventId, "co@example.com");
    await db.query("INSERT INTO submissions(id,event_id,code,status,source) VALUES($1,$2,1,'accepted','manual')", [submissionId, eventId]);
    await db.query("INSERT INTO submission_participants(event_id,submission_id,contact_id,is_primary) VALUES($1,$2,$3,true),($1,$2,$4,false)", [eventId, submissionId, primary, coSpeaker]);
    await db.query("INSERT INTO portal_tasks(id,event_id,name,target_type,completion_mode) VALUES($1,$2,'Slides','submission','manual')", [taskId, eventId]);
    const result = await db.query<{ contact_id: string }>("SELECT contact_id FROM task_assignments_v WHERE task_id=$1", [taskId]);
    expect(result.rows).toEqual([{ contact_id: primary }]);
  });

  it("uses the database clock for form openness and prevents public leakage", async () => {
    const eventId = "80000000-0000-4000-8000-000000000001";
    const formId = "80000000-0000-4000-8000-000000000002";
    const contactId = "80000000-0000-4000-8000-000000000003";
    const sessionId = "80000000-0000-4000-8000-000000000004";
    await insertEvent(eventId, "leakage-event");
    await insertContact(contactId, eventId, "hidden@example.com", "unconfirmed");
    await db.query("INSERT INTO forms(id,event_id,context,internal_name,status,closes_at) VALUES($1,$2,'cfp','Closed','open',now()-interval '1 second')", [formId, eventId]);
    const open = await db.query<{ open: boolean }>("SELECT is_form_open($1) AS open", [formId]);
    expect(open.rows[0]?.open).toBe(false);
    await db.query("INSERT INTO sessions(id,event_id,title,slug,starts_at,ends_at,status) VALUES($1,$2,'Draft','draft','2026-09-15T16:00:00Z','2026-09-15T16:30:00Z','draft')", [sessionId, eventId]);
    await db.query("INSERT INTO session_speakers(event_id,session_id,contact_id) VALUES($1,$2,$3)", [eventId, sessionId, contactId]);
    const sessions = await db.query("SELECT * FROM published_sessions_v WHERE event_id=$1", [eventId]);
    const speakers = await db.query("SELECT * FROM published_speakers_v WHERE event_id=$1", [eventId]);
    expect(sessions.rows).toHaveLength(0);
    expect(speakers.rows).toHaveLength(0);
  });
});
