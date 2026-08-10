import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import type { DbOrTx } from "@/db/client";
import * as schema from "@/db/schema";
import { contactIdSchema, eventIdSchema, fileRequestIdSchema, submissionIdSchema, taskIdSchema, userIdSchema } from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";

const migration0 = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");
const migration6 = readFileSync(new URL("../../drizzle/0006_content_deliverables.sql", import.meta.url), "utf8");

const eventId = eventIdSchema.parse("e5000000-0000-4000-8000-000000000001");
const otherEventId = eventIdSchema.parse("e5000000-0000-4000-8000-000000000002");
const ada = contactIdSchema.parse("e5000000-0000-4000-8000-000000000010");
const grace = contactIdSchema.parse("e5000000-0000-4000-8000-000000000011");
const talkOne = "e5000000-0000-4000-8000-000000000020";
const talkTwo = "e5000000-0000-4000-8000-000000000021";
const slidesRequest = fileRequestIdSchema.parse("e5000000-0000-4000-8000-000000000030");
const headshotRequest = fileRequestIdSchema.parse("e5000000-0000-4000-8000-000000000031");
const slidesTask = taskIdSchema.parse("e5000000-0000-4000-8000-000000000040");
const headshotTask = taskIdSchema.parse("e5000000-0000-4000-8000-000000000041");
const deckAsset = "e5000000-0000-4000-8000-000000000050";
const deckAssetV2 = "e5000000-0000-4000-8000-000000000051";

let pglite: PGlite;

describe("M52: the central Files view's deliverable list", () => {
  let listDeliverablesIn: typeof import("@/features/portal/deliverables/server/queries").listDeliverablesIn;
  let db: DbOrTx;

  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migration0);
    await pglite.exec(migration1);
    await pglite.exec(migration6);
    db = drizzle(pglite, { schema }) as unknown as DbOrTx;
    ({ listDeliverablesIn } = await import("@/features/portal/deliverables/server/queries"));

    await pglite.query("INSERT INTO users(id,email,name) VALUES($1,'organizer@example.com','Organizer')", ["e5000000-0000-4000-8000-0000000000aa"]);
    for (const [id, slug] of [[eventId, "files-event"], [otherEventId, "other-files-event"]] as const) {
      await pglite.query(
        "INSERT INTO events(id,name,slug,timezone,starts_at,ends_at) VALUES($1,$2,$3,'America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
        [id, slug, slug],
      );
    }
    await pglite.query("INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES($1,$2,'ada@example.com','Ada','Lovelace')", [ada, eventId]);
    await pglite.query("INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES($1,$2,'grace@example.com','Grace','Hopper')", [grace, eventId]);

    await pglite.query(
      "INSERT INTO submissions(id,event_id,code,title,status,submitted_at) VALUES($1,$2,1,'Caching at the edge','accepted', now())",
      [talkOne, eventId],
    );
    await pglite.query("INSERT INTO submission_participants(event_id,submission_id,contact_id,is_primary,sort_order) VALUES($1,$2,$3,true,0)", [eventId, talkOne, ada]);
    await pglite.query(
      "INSERT INTO submissions(id,event_id,code,title,status,submitted_at) VALUES($1,$2,2,'Agents that ship','accepted', now())",
      [talkTwo, eventId],
    );
    await pglite.query("INSERT INTO submission_participants(event_id,submission_id,contact_id,is_primary,sort_order) VALUES($1,$2,$3,true,0)", [eventId, talkTwo, grace]);

    await pglite.query(
      "INSERT INTO file_requests(id,event_id,title,target_type,max_size_mb) VALUES($1,$2,'Slides','submission',25)",
      [slidesRequest, eventId],
    );
    await pglite.query(
      "INSERT INTO file_requests(id,event_id,title,target_type,max_size_mb) VALUES($1,$2,'Headshot','contact',5)",
      [headshotRequest, eventId],
    );
    await pglite.query(
      "INSERT INTO portal_tasks(id,event_id,name,target_type,completion_mode,file_request_id,due_at) VALUES($1,$2,'Upload slides','submission','file_request',$3, now() - interval '2 days')",
      [slidesTask, eventId, slidesRequest],
    );
    await pglite.query(
      "INSERT INTO portal_tasks(id,event_id,name,target_type,completion_mode,file_request_id) VALUES($1,$2,'Upload headshot','contact','file_request',$3)",
      [headshotTask, eventId, headshotRequest],
    );

    // Ada's slides deliverable has two versions, latest wins.
    await pglite.query(
      "INSERT INTO file_assets(id,event_id,kind,r2_key,filename,mime,size_bytes) VALUES($1,$2,'upload','k1','deck-v1.pdf','application/pdf',1000)",
      [deckAsset, eventId],
    );
    await pglite.query(
      "INSERT INTO file_assets(id,event_id,kind,r2_key,filename,mime,size_bytes) VALUES($1,$2,'upload','k2','deck-v2.pdf','application/pdf',2000)",
      [deckAssetV2, eventId],
    );
    await pglite.query(
      "INSERT INTO file_uploads(event_id,file_request_id,contact_id,submission_id,file_asset_id,version,is_latest) VALUES($1,$2,$3,$4,$5,1,false)",
      [eventId, slidesRequest, ada, talkOne, deckAsset],
    );
    await pglite.query(
      "INSERT INTO file_uploads(event_id,file_request_id,contact_id,submission_id,file_asset_id,version,is_latest) VALUES($1,$2,$3,$4,$5,2,true)",
      [eventId, slidesRequest, ada, talkOne, deckAssetV2],
    );
    await pglite.query(
      "INSERT INTO file_comments(event_id,file_request_id,contact_id,submission_id,author_role,author_contact_id,body) VALUES($1,$2,$3,$4,'speaker',$3,'Here it is')",
      [eventId, slidesRequest, ada, talkOne],
    );
    // Grace's slides deliverable has no upload at all — the "missing a file" case.
  }, 60_000);

  it("lists one row per deliverable slot, with the latest version and counts folded in", async () => {
    const rows = await listDeliverablesIn(db, eventId);
    // Ada's slides (has a file), Grace's slides (no file), and the two
    // contact-targeted headshot slots — one row per accepted speaker.
    expect(rows).toHaveLength(4);

    const adaSlides = rows.find((row) => row.contactId === ada && row.fileRequestId === slidesRequest);
    expect(adaSlides?.latestVersion?.filename).toBe("deck-v2.pdf");
    expect(adaSlides?.latestVersion?.version).toBe(2);
    expect(adaSlides?.versionCount).toBe(2);
    expect(adaSlides?.commentCount).toBe(1);
    expect(adaSlides?.overdue).toBe(true);

    const graceSlides = rows.find((row) => row.contactId === grace && row.fileRequestId === slidesRequest);
    expect(graceSlides?.latestVersion).toBeNull();
    expect(graceSlides?.versionCount).toBe(0);
  });

  it("filters by task, file request, hasUpload and free-text search", async () => {
    const byTask = await listDeliverablesIn(db, eventId, { taskId: headshotTask });
    expect(byTask).toHaveLength(2);
    expect(byTask.every((row) => row.taskId === headshotTask)).toBe(true);

    const byRequest = await listDeliverablesIn(db, eventId, { fileRequestId: slidesRequest });
    expect(byRequest).toHaveLength(2);

    const withFile = await listDeliverablesIn(db, eventId, { hasUpload: true });
    expect(withFile.map((row) => row.contactId)).toEqual([ada]);

    const missingFile = await listDeliverablesIn(db, eventId, { hasUpload: false, fileRequestId: slidesRequest });
    expect(missingFile.some((row) => row.contactId === ada)).toBe(false);
    expect(missingFile.some((row) => row.contactId === grace)).toBe(true);

    const searched = await listDeliverablesIn(db, eventId, { search: "lovelace" });
    expect(searched.every((row) => row.contactId === ada)).toBe(true);
    expect(searched.length).toBeGreaterThan(0);
  });

  it("filters by completion/overdue state", async () => {
    const overdue = await listDeliverablesIn(db, eventId, { state: "overdue" });
    expect(overdue.every((row) => row.overdue)).toBe(true);
    expect(overdue.some((row) => row.contactId === ada)).toBe(true);

    const open = await listDeliverablesIn(db, eventId, { state: "open" });
    expect(open.every((row) => !row.completed)).toBe(true);
  });

  it("never crosses the event boundary", async () => {
    expect(await listDeliverablesIn(db, otherEventId)).toEqual([]);
  });

  describe("createFileExportJobIn / processFileExportJobIn", () => {
    it("re-derives the latest file per slot server-side and freezes it into the job", async () => {
      const { createFileExportJobIn } = await import("@/features/portal/deliverables/server/export");
      const job = await createFileExportJobIn(
        db, eventId, userIdSchema.parse("e5000000-0000-4000-8000-0000000000aa"),
        [{ taskId: slidesTask, contactId: ada, submissionId: submissionIdSchema.parse(talkOne) }],
        "none",
      );
      expect(job.status).toBe("pending");
      expect(job.entryCount).toBe(0);

      const stored = await pglite.query<{ file_upload_ids: string[] }>("SELECT file_upload_ids FROM file_export_jobs WHERE id = $1", [job.id]);
      expect(stored.rows[0]?.file_upload_ids).toHaveLength(1);
      // Points at the *latest* (v2) upload, never the superseded v1 one —
      // "latest is server-derived" even though the client only ever named
      // the slot (task/contact/submission), not a version.
      const uploadRow = await pglite.query<{ file_asset_id: string }>(
        "SELECT file_asset_id FROM file_uploads WHERE id = $1", [stored.rows[0]?.file_upload_ids[0]],
      );
      expect(uploadRow.rows[0]?.file_asset_id).toBe(deckAssetV2);
    });

    it("refuses a selection where nothing has an uploaded file", async () => {
      const { createFileExportJobIn } = await import("@/features/portal/deliverables/server/export");
      const failed = await createFileExportJobIn(
        db, eventId, null,
        [{ taskId: slidesTask, contactId: grace, submissionId: submissionIdSchema.parse(talkTwo) }],
        "none",
      ).catch((thrown: unknown) => thrown);
      expect(isAppError(failed) && failed.code).toBe("VALIDATION");
    });

    it("silently drops a target with no file rather than failing the whole export", async () => {
      const { createFileExportJobIn } = await import("@/features/portal/deliverables/server/export");
      const job = await createFileExportJobIn(
        db, eventId, null,
        [
          { taskId: slidesTask, contactId: ada, submissionId: submissionIdSchema.parse(talkOne) },
          { taskId: slidesTask, contactId: grace, submissionId: submissionIdSchema.parse(talkTwo) },
        ],
        "none",
      );
      const stored = await pglite.query<{ file_upload_ids: string[] }>("SELECT file_upload_ids FROM file_export_jobs WHERE id = $1", [job.id]);
      // Only Ada's slot resolved to a file; Grace's contributed nothing.
      expect(stored.rows[0]?.file_upload_ids).toHaveLength(1);
    });

    it("never gets stuck in `processing`: a claimed job that cannot read its bytes fails cleanly", async () => {
      // No Cloudflare/R2 context exists in this test environment, so the byte
      // read inside processFileExportJobIn is guaranteed to throw — this
      // proves the failure path lands the job in `failed`, not stranded.
      const { createFileExportJobIn, getFileExportJobIn, processFileExportJobIn } = await import("@/features/portal/deliverables/server/export");
      const job = await createFileExportJobIn(
        db, eventId, null,
        [{ taskId: slidesTask, contactId: ada, submissionId: submissionIdSchema.parse(talkOne) }],
        "speaker",
      );
      await processFileExportJobIn(db, eventId, job.id);
      const after = await getFileExportJobIn(db, eventId, job.id);
      expect(after?.status).toBe("failed");
      expect(after?.error).toBeTruthy();
    });

    it("a job for another event is invisible to getFileExportJobIn", async () => {
      const { createFileExportJobIn, getFileExportJobIn } = await import("@/features/portal/deliverables/server/export");
      const job = await createFileExportJobIn(
        db, eventId, null,
        [{ taskId: slidesTask, contactId: ada, submissionId: submissionIdSchema.parse(talkOne) }],
        "none",
      );
      expect(await getFileExportJobIn(db, otherEventId, job.id)).toBeNull();
    });
  });
});
