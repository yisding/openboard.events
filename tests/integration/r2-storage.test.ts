import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ORPHAN_PREDICATE_SQL } from "@/shared/server/r2";

const migration0 = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");

const EVENT_ID = "44444444-4444-4444-8444-444444444441";
const CONTACT_ID = "44444444-4444-4444-8444-444444444442";

let db: PGlite;

/** Mirrors cleanupOrphanUploads, sharing its predicate so the two cannot drift. */
async function sweep(olderThanHours = 24): Promise<string[]> {
  const result = await db.query<{ r2_key: string }>(
    `DELETE FROM file_assets fa
     WHERE fa.created_at < now() - ($1 || ' hours')::interval AND ${ORPHAN_PREDICATE_SQL}
     RETURNING fa.r2_key`,
    [String(olderThanHours)],
  );
  return result.rows.map((row) => row.r2_key);
}

async function insertAsset(id: string, key: string, ageHours: number, kind = "upload") {
  await db.query(
    `INSERT INTO file_assets(id,event_id,kind,r2_key,filename,mime,size_bytes,created_at)
     VALUES($1,$2,$3,$4,'file.pdf','application/pdf',1024, now() - ($5 || ' hours')::interval)`,
    [id, EVENT_ID, kind, key, String(ageHours)],
  );
}

describe("orphan upload sweep", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(migration0);
    await db.exec(migration1);
    await db.query(
      "INSERT INTO events(id,name,slug,starts_at,ends_at) VALUES($1,'R2 Event','r2-event','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
      [EVENT_ID],
    );
    await db.query(
      "INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES($1,$2,'speaker@example.com','Test','Speaker')",
      [CONTACT_ID, EVENT_ID],
    );
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  it("deletes an unreferenced 25-hour-old row and keeps a referenced one", async () => {
    const orphan = "44444444-4444-4444-8444-00000000000a";
    const referenced = "44444444-4444-4444-8444-00000000000b";
    await insertAsset(orphan, "evt/orphan/a", 25);
    await insertAsset(referenced, "evt/referenced/b", 25, "headshot");
    await db.query("UPDATE contacts SET headshot_file_id=$1 WHERE id=$2", [referenced, CONTACT_ID]);

    expect(await sweep()).toEqual(["evt/orphan/a"]);

    const survivors = await db.query<{ id: string }>("SELECT id FROM file_assets");
    expect(survivors.rows.map((row) => row.id)).toEqual([referenced]);
  });

  it("spares a row that is younger than the threshold", async () => {
    const fresh = "44444444-4444-4444-8444-00000000000c";
    await insertAsset(fresh, "evt/fresh/c", 1);
    expect(await sweep()).toEqual([]);
    await db.query("DELETE FROM file_assets WHERE id=$1", [fresh]);
  });

  it("spares files held by every owning column the predicate knows about", async () => {
    const logo = "44444444-4444-4444-8444-00000000000d";
    const background = "44444444-4444-4444-8444-00000000000e";
    const answerFile = "44444444-4444-4444-8444-00000000000f";
    const taskUpload = "44444444-4444-4444-8444-000000000010";
    const responseFile = "44444444-4444-4444-8444-000000000011";
    for (const [id, key] of [
      [logo, "evt/logo"],
      [background, "evt/bg"],
      [answerFile, "evt/answer"],
      [taskUpload, "evt/task"],
      [responseFile, "evt/response"],
    ] as const) {
      await insertAsset(id, key, 48);
    }
    await db.query("UPDATE events SET logo_file_id=$1, background_file_id=$2 WHERE id=$3", [logo, background, EVENT_ID]);

    const formId = "44444444-4444-4444-8444-000000000020";
    const fieldId = "44444444-4444-4444-8444-000000000021";
    const submissionId = "44444444-4444-4444-8444-000000000022";
    const requestId = "44444444-4444-4444-8444-000000000023";
    const sectionId = "44444444-4444-4444-8444-000000000024";
    await db.query("INSERT INTO forms(id,event_id,context,internal_name) VALUES($1,$2,'cfp','CFP')", [formId, EVENT_ID]);
    await db.query("INSERT INTO form_sections(id,event_id,form_id,key) VALUES($1,$2,$3,'main')", [sectionId, EVENT_ID, formId]);
    await db.query(
      "INSERT INTO form_fields(id,event_id,form_id,section_id,key,label,field_type) VALUES($1,$2,$3,$4,'deck','Deck','file')",
      [fieldId, EVENT_ID, formId, sectionId],
    );
    await db.query("INSERT INTO submissions(id,event_id,code,status,source) VALUES($1,$2,901,'pending','manual')", [submissionId, EVENT_ID]);
    await db.query(
      "INSERT INTO submission_answers(event_id,submission_id,field_id,value) VALUES($1,$2,$3,$4::jsonb)",
      [EVENT_ID, submissionId, fieldId, JSON.stringify({ t: "file", v: answerFile })],
    );
    await db.query("INSERT INTO file_requests(id,event_id,title) VALUES($1,$2,'Slides')", [requestId, EVENT_ID]);
    await db.query(
      "INSERT INTO file_uploads(event_id,file_request_id,contact_id,file_asset_id) VALUES($1,$2,$3,$4)",
      [EVENT_ID, requestId, CONTACT_ID, taskUpload],
    );
    // A portal form response holds its file answers in one jsonb object, not a row per answer.
    await db.query(
      `INSERT INTO form_responses(event_id,form_id,form_version,contact_id,answers) VALUES($1,$2,1,$3,$4::jsonb)`,
      [EVENT_ID, formId, CONTACT_ID, JSON.stringify({ [fieldId]: { t: "file", v: responseFile }, note: { t: "text", v: "hi" } })],
    );

    expect(await sweep()).toEqual([]);
  });

  it("sweeps past a form response whose answers are not an object", async () => {
    const orphan = "44444444-4444-4444-8444-000000000012";
    const otherContact = "44444444-4444-4444-8444-000000000013";
    await insertAsset(orphan, "evt/orphan/second", 48);
    await db.query(
      "INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES($1,$2,'second@example.com','Second','Speaker')",
      [otherContact, EVENT_ID],
    );
    await db.query(
      `INSERT INTO form_responses(event_id,form_id,form_version,contact_id,answers)
       VALUES($1,(SELECT id FROM forms LIMIT 1),1,$2,'null'::jsonb)`,
      [EVENT_ID, otherContact],
    );

    expect(await sweep()).toEqual(["evt/orphan/second"]);
  });
});
