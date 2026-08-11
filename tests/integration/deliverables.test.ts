import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { DbOrTx } from "@/db/client";
import * as schema from "@/db/schema";
import { contactIdSchema, eventIdSchema, fileRequestIdSchema, submissionIdSchema, taskIdSchema, userIdSchema } from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";
import { buildExportZipKey } from "@/shared/server/r2";

/**
 * M52-ZIP's resumable export never touches a real R2 binding in this
 * environment (no fake binding is available in any harness here — see the
 * module header), so its multi-step *orchestration* — spanning more than one
 * `processFileExportJobIn` call, each bounded to one part — is exercised
 * against an in-memory stand-in for exactly the five R2-touching functions
 * `deliverables/server/export.ts` calls, rather than skipped. Everything
 * else (query shape, authorization scoping, claim/lease semantics) still
 * runs the real database code below; only object storage is faked.
 */
const exportR2Fake = vi.hoisted(() => ({
  sourceObjects: new Map<string, Uint8Array>(),
  uploads: new Map<string, (Uint8Array | undefined)[]>(),
  published: new Map<string, Uint8Array>(),
  // Set once `beforeAll` below creates the PGlite instance — `publishExportAsset`
  // still needs to insert a real `file_assets` row (the completion `UPDATE`'s
  // `result_file_id` foreign key requires one to exist), just not through a
  // real R2 write.
  db: null as DbOrTx | null,
}));

vi.mock("@/shared/server/r2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/server/r2")>();
  return {
    ...actual,
    getObjectBytes: async (key: string) => exportR2Fake.sourceObjects.get(key) ?? null,
    deleteObjects: async () => ({ stranded: [] as string[] }),
    beginExportMultipart: async (key: string) => {
      const uploadId = `up-${key}-${exportR2Fake.uploads.size}`;
      exportR2Fake.uploads.set(uploadId, []);
      return uploadId;
    },
    uploadExportPart: async (_key: string, uploadId: string, partNumber: number, bytes: Uint8Array) => {
      const parts = exportR2Fake.uploads.get(uploadId) ?? [];
      parts[partNumber - 1] = bytes;
      exportR2Fake.uploads.set(uploadId, parts);
      return { partNumber, etag: `etag-${partNumber}` };
    },
    completeExportMultipart: async (key: string, uploadId: string) => {
      const parts = (exportR2Fake.uploads.get(uploadId) ?? []).filter((part): part is Uint8Array => Boolean(part));
      const total = parts.reduce((sum, part) => sum + part.length, 0);
      const combined = new Uint8Array(total);
      let at = 0;
      for (const part of parts) { combined.set(part, at); at += part.length; }
      exportR2Fake.published.set(key, combined);
    },
    abortExportMultipart: async (_key: string, uploadId: string) => { exportR2Fake.uploads.delete(uploadId); },
    publishExportAsset: async (input: { fileId: string; eventId: string; key: string; sizeBytes: number }) => {
      if (!exportR2Fake.db) throw new Error("test setup: exportR2Fake.db was never set");
      await exportR2Fake.db.execute(sql`
        INSERT INTO file_assets (id,event_id,kind,r2_key,filename,mime,size_bytes)
        VALUES (${input.fileId}, ${input.eventId}, 'attachment', ${input.key}, 'export.zip', 'application/zip', ${input.sizeBytes})
      `);
    },
  };
});

const migration0 = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");
const migration6 = readFileSync(new URL("../../drizzle/0006_content_deliverables.sql", import.meta.url), "utf8");
// M52-ZIP: adds file_export_jobs.export_state, the resumable export's
// progress column.
const migration15 = readFileSync(new URL("../../drizzle/0015_export_streaming.sql", import.meta.url), "utf8");

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
    await pglite.exec(migration15);
    db = drizzle(pglite, { schema }) as unknown as DbOrTx;
    exportR2Fake.db = db;
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

  it("computes the central Files view's tab-badge counts from a filtered aggregate, not from a fetched row set", async () => {
    const { getDeliverableStateCountsIn } = await import("@/features/portal/deliverables/server/queries");
    const [all, counts] = await Promise.all([
      listDeliverablesIn(db, eventId),
      getDeliverableStateCountsIn(db, eventId),
    ]);
    expect(counts.all).toBe(all.length);
    expect(counts.open).toBe(all.filter((row) => !row.completed).length);
    expect(counts.overdue).toBe(all.filter((row) => row.overdue).length);
    expect(counts.completed).toBe(all.filter((row) => row.completed).length);

    // A search narrows the badges — the same discipline `getStatusCountsIn`
    // keeps for Abstracts — because an organizer who has already typed
    // "lovelace" should not see "Open (4)" implying three other rows exist.
    const [adaOnly, adaCounts] = await Promise.all([
      listDeliverablesIn(db, eventId, { search: "lovelace" }),
      getDeliverableStateCountsIn(db, eventId, { search: "lovelace" }),
    ]);
    expect(adaCounts.all).toBe(adaOnly.length);
    expect(adaCounts.all).toBeLessThan(counts.all);

    // Never crosses the event boundary either.
    expect((await getDeliverableStateCountsIn(db, otherEventId)).all).toBe(0);
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
      // The fake R2 layer above has no object registered for this file's key,
      // so every read resolves to "missing" (matching the real `getObjectBytes`'s
      // own contract for an object that isn't there) — this proves the
      // failure path lands the job in `failed`, not stranded, once every file
      // in a batch comes back empty.
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

  describe("processFileExportJobIn: multi-step resumption", () => {
    const irene = contactIdSchema.parse("e5000000-0000-4000-8000-000000000012");
    const bigRequest = fileRequestIdSchema.parse("e5000000-0000-4000-8000-000000000060");
    const bigTask = taskIdSchema.parse("e5000000-0000-4000-8000-000000000061");
    const bigAsset1 = "e5000000-0000-4000-8000-000000000070";
    const bigAsset2 = "e5000000-0000-4000-8000-000000000071";
    const bigAsset3 = "e5000000-0000-4000-8000-000000000072";

    const talkThree = "e5000000-0000-4000-8000-000000000022";

    beforeAll(async () => {
      await pglite.query("INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES($1,$2,'irene@example.com','Irene','Adler')", [irene, eventId]);
      // Contact-targeted tasks resolve through `accepted_speakers_v`
      // (`task_assignments_v`'s own definition), so Irene needs an accepted
      // submission too — an upload-only contact with no talk at all would
      // never show up as assignable, the same as any other contact-targeted
      // deliverable in this codebase.
      await pglite.query(
        "INSERT INTO submissions(id,event_id,code,title,status,submitted_at) VALUES($1,$2,3,'Adversarial ZIPs','accepted', now())",
        [talkThree, eventId],
      );
      await pglite.query("INSERT INTO submission_participants(event_id,submission_id,contact_id,is_primary,sort_order) VALUES($1,$2,$3,true,0)", [eventId, talkThree, irene]);
      await pglite.query(
        "INSERT INTO file_requests(id,event_id,title,target_type,max_size_mb) VALUES($1,$2,'Big files','contact',100)",
        [bigRequest, eventId],
      );
      await pglite.query(
        "INSERT INTO portal_tasks(id,event_id,name,target_type,completion_mode,file_request_id) VALUES($1,$2,'Upload a big file','contact','file_request',$3)",
        [bigTask, eventId, bigRequest],
      );
      // `size_bytes` alone drives `planExportBatch`'s byte-target decision;
      // the real object bytes registered in `exportR2Fake` below are tiny —
      // this test is about the multi-step *orchestration* crossing
      // `EXPORT_PART_TARGET_BYTES` more than once, not about moving real
      // megabytes (that is what docs/evidence/m52-zip-cpu-measurement.md
      // measures against real workerd).
      // Equal sizes deliberately: `createFileExportJobIn`'s `SELECT DISTINCT`
      // freezes `file_upload_ids` in whatever order Postgres happens to
      // return, not insertion order, so the split this test asserts on must
      // hold for *any* ordering of these three ids — any two of three equal
      // 4 MB files already clear the 6 MiB-ish part target, while any one
      // alone never does.
      const declaredSizes: [string, number][] = [[bigAsset1, 4_000_000], [bigAsset2, 4_000_000], [bigAsset3, 4_000_000]];
      for (const [id, sizeBytes] of declaredSizes) {
        await pglite.query(
          "INSERT INTO file_assets(id,event_id,kind,r2_key,filename,mime,size_bytes) VALUES($1,$2,'upload',$3,$4,'application/pdf',$5)",
          [id, eventId, `big/${id}.bin`, `${id}.pdf`, sizeBytes],
        );
      }
      const contactsInOrder: [string, string][] = [[ada, bigAsset1], [grace, bigAsset2], [irene, bigAsset3]];
      for (const [contactId, assetId] of contactsInOrder) {
        await pglite.query(
          "INSERT INTO file_uploads(event_id,file_request_id,contact_id,file_asset_id,version,is_latest) VALUES($1,$2,$3,$4,1,true)",
          [eventId, bigRequest, contactId, assetId],
        );
      }
      for (const [assetId] of declaredSizes) {
        exportR2Fake.sourceObjects.set(`big/${assetId}.bin`, new TextEncoder().encode(`bytes for ${assetId}`));
      }
    }, 60_000);

    it("needs more than one processFileExportJobIn call to complete once the batch exceeds the part-size target, and produces a correct archive", async () => {
      const { createFileExportJobIn, getFileExportJobIn, processFileExportJobIn } = await import("@/features/portal/deliverables/server/export");
      const job = await createFileExportJobIn(
        db, eventId, null,
        [
          { taskId: bigTask, contactId: ada, submissionId: null },
          { taskId: bigTask, contactId: grace, submissionId: null },
          { taskId: bigTask, contactId: irene, submissionId: null },
        ],
        "none",
      );
      expect(job.status).toBe("pending");

      // Step 1: the first two files alone (4.5 MB + 4.5 MB) already clear the
      // part-size target, so this step stops there — the third file is
      // deliberately left for a second step.
      await processFileExportJobIn(db, eventId, job.id);
      const afterStepOne = await getFileExportJobIn(db, eventId, job.id);
      expect(afterStepOne?.status).toBe("processing");
      const progress = await pglite.query<{ export_state: { nextIndex: number; uploadId: string | null } }>(
        "SELECT export_state FROM file_export_jobs WHERE id = $1", [job.id],
      );
      expect(progress.rows[0]?.export_state.nextIndex).toBe(2);
      const uploadId = progress.rows[0]?.export_state.uploadId;
      expect(uploadId).toBeTruthy();

      // Step 2: the one remaining file finishes the job — same job, same
      // multipart upload id, resumed rather than restarted.
      await processFileExportJobIn(db, eventId, job.id);
      const completed = await getFileExportJobIn(db, eventId, job.id);
      expect(completed?.status).toBe("completed");
      expect(completed?.entryCount).toBe(3);
      const resultFileId = completed?.resultFileId;
      if (!resultFileId) throw new Error("test setup: expected a resultFileId on a completed job");

      const key = buildExportZipKey(eventId, resultFileId);
      const zip = exportR2Fake.published.get(key);
      if (!zip) throw new Error("test setup: expected a published archive at the export's key");
      // A from-scratch read of the produced archive's central directory,
      // independent of the code that built it: three entries, and the
      // archive's declared end matches its actual length.
      const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
      let eocdOffset = -1;
      for (let offset = zip.length - 22; offset >= 0; offset -= 1) {
        if (view.getUint32(offset, true) === 0x06054b50) { eocdOffset = offset; break; }
      }
      expect(eocdOffset).toBeGreaterThanOrEqual(0);
      expect(view.getUint16(eocdOffset + 10, true)).toBe(3);
    });

    it("a single-step job (fits under the part-size target in one call) still completes and needs no second step", async () => {
      const { createFileExportJobIn, getFileExportJobIn, processFileExportJobIn } = await import("@/features/portal/deliverables/server/export");
      const job = await createFileExportJobIn(db, eventId, null, [{ taskId: bigTask, contactId: irene, submissionId: null }], "none");
      await processFileExportJobIn(db, eventId, job.id);
      const after = await getFileExportJobIn(db, eventId, job.id);
      expect(after?.status).toBe("completed");
      expect(after?.entryCount).toBe(1);
    });
  });
});
