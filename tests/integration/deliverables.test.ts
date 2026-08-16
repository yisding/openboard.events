import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { DbOrTx } from "@/db/client";
import * as schema from "@/db/schema";
import { contactIdSchema, eventIdSchema, fileCommentIdSchema, fileRequestIdSchema, submissionIdSchema, taskIdSchema, userIdSchema } from "@/shared/contracts";
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
  /** Optional hook fired on every source read, so a test can interleave a concurrent writer mid-step. */
  onGetObject: null as null | (() => Promise<void>),
}));

vi.mock("@/shared/server/r2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/server/r2")>();
  return {
    ...actual,
    getObjectBytes: async (key: string) => {
      await exportR2Fake.onGetObject?.();
      return exportR2Fake.sourceObjects.get(key) ?? null;
    },
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

  it("replays an outcome-unknown organizer comment without creating a duplicate", async () => {
    const { addFileCommentIn, listFileCommentsIn } = await import("@/features/portal/server/deliverable-slot");
    const commentId = fileCommentIdSchema.parse("e5000000-0000-4000-8000-000000000090");
    const organizerId = userIdSchema.parse("e5000000-0000-4000-8000-0000000000aa");
    const author = { role: "organizer" as const, userId: organizerId };

    const first = await addFileCommentIn(
      db, eventId, slidesRequest, ada, submissionIdSchema.parse(talkOne), author, "Looks good", commentId,
    );
    const replay = await addFileCommentIn(
      db, eventId, slidesRequest, ada, submissionIdSchema.parse(talkOne), author, "Looks good", commentId,
    );

    expect(replay).toEqual(first);
    const comments = await listFileCommentsIn(db, eventId, slidesRequest, ada, submissionIdSchema.parse(talkOne));
    expect(comments.filter((comment) => comment.id === commentId)).toHaveLength(1);
  });

  it("does not let a stable comment id be replayed for different content", async () => {
    const { addFileCommentIn } = await import("@/features/portal/server/deliverable-slot");
    const commentId = fileCommentIdSchema.parse("e5000000-0000-4000-8000-000000000091");
    const author = { role: "organizer" as const, userId: userIdSchema.parse("e5000000-0000-4000-8000-0000000000aa") };
    await addFileCommentIn(db, eventId, slidesRequest, ada, submissionIdSchema.parse(talkOne), author, "Original", commentId);

    const refusal = await addFileCommentIn(
      db, eventId, slidesRequest, ada, submissionIdSchema.parse(talkOne), author, "Different", commentId,
    ).catch((error: unknown) => error);
    expect(isAppError(refusal) && refusal.code).toBe("CONFLICT");
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

    // The Speaker column renders "Ada Lovelace" and the box is labelled "Search
    // speaker, request, or session", so copying that name out of the table has
    // to match. Matching first and last name separately meant the obvious
    // gesture found nothing and every tab badge dropped to 0.
    const [fullName, fullNameCounts] = await Promise.all([
      listDeliverablesIn(db, eventId, { search: "Ada Lovelace" }),
      getDeliverableStateCountsIn(db, eventId, { search: "Ada Lovelace" }),
    ]);
    expect(fullName.length).toBe(adaOnly.length);
    expect(fullNameCounts.all).toBe(adaCounts.all);
    expect(fullNameCounts.all).toBeGreaterThan(0);

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
      // These files carry *real* bytes matching their declared `size_bytes`.
      // They used to be tiny while `size_bytes` claimed 4 MB, which made every
      // non-final part about 40 bytes — far under R2's 5 MiB floor, invisible
      // only because the fake R2 here does not enforce it. A part is now sized
      // by the bytes actually read, so the fixture has to be honest for this
      // test to exercise the multi-step split it is named for. Three 4 MB
      // buffers is the smallest set where any two clear the ~6 MiB target and
      // any one alone does not.
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
      for (const [assetId, sizeBytes] of declaredSizes) {
        const bytes = new Uint8Array(sizeBytes);
        // Not all-zero: a constant buffer would make every entry's CRC identical
        // and hide a mis-paired name/bytes association.
        for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i + assetId.charCodeAt(assetId.length - 1)) % 251;
        exportR2Fake.sourceObjects.set(`big/${assetId}.bin`, bytes);
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

      // Step 1: the first two files alone (4 MB + 4 MB) already clear the
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

      // R2 rejects a multipart complete() if any non-final part is under 5 MiB,
      // and it does so only at the very end — after every other batch has
      // already been read and uploaded. Assert the invariant here, where the
      // failure is attributable.
      const partsSoFar = exportR2Fake.uploads.get(String(uploadId)) ?? [];
      expect(partsSoFar.length).toBe(1);
      expect(partsSoFar[0]?.length ?? 0).toBeGreaterThanOrEqual(5 * 1024 * 1024);

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

    it("never uploads a non-final part under R2's 5 MiB floor when objects are smaller than the rows claim", async () => {
      // `planExportBatch` sizes a batch from the DB's `size_bytes`, but a row
      // whose object is missing or short contributes nothing to the part
      // actually uploaded. Three rows each *claiming* 3.5 MB but carrying
      // 100 KB: any two clear the ~6 MiB target, so — whatever order
      // `createFileExportJobIn`'s SELECT DISTINCT freezes — the first batch is
      // two rows and used to upload a ~200 KB non-final part. R2 rejects that
      // at complete(), long after every other batch has been read and
      // uploaded, with an opaque EntityTooSmall.
      const shortRequest = fileRequestIdSchema.parse("e5000000-0000-4000-8000-000000000090");
      const shortTask = taskIdSchema.parse("e5000000-0000-4000-8000-000000000091");
      await pglite.query(
        "INSERT INTO file_requests(id,event_id,title,target_type,accepted_extensions,max_size_mb) VALUES($1,$2,'Short bytes','contact',ARRAY['pdf'],100)",
        [shortRequest, eventId],
      );
      await pglite.query(
        "INSERT INTO portal_tasks(id,event_id,name,target_type,completion_mode,file_request_id) VALUES($1,$2,'Short bytes','contact','file_request',$3)",
        [shortTask, eventId, shortRequest],
      );
      const shortAssets = [
        "e5000000-0000-4000-8000-000000000092",
        "e5000000-0000-4000-8000-000000000093",
        "e5000000-0000-4000-8000-000000000094",
      ];
      const shortContacts = [ada, grace, irene];
      for (const [index, assetId] of shortAssets.entries()) {
        await pglite.query(
          "INSERT INTO file_assets(id,event_id,kind,r2_key,filename,mime,size_bytes) VALUES($1,$2,'upload',$3,$4,'application/pdf',3500000)",
          [assetId, eventId, `short/${assetId}.bin`, `${assetId}.pdf`],
        );
        await pglite.query(
          "INSERT INTO file_uploads(event_id,file_request_id,contact_id,file_asset_id,version,is_latest) VALUES($1,$2,$3,$4,1,true)",
          [eventId, shortRequest, shortContacts[index], assetId],
        );
        exportR2Fake.sourceObjects.set(`short/${assetId}.bin`, new Uint8Array(100_000).fill((index + 7) % 251));
      }

      const { createFileExportJobIn, getFileExportJobIn, processFileExportJobIn } = await import("@/features/portal/deliverables/server/export");
      const job = await createFileExportJobIn(
        db, eventId, null,
        shortContacts.map((contactId) => ({ taskId: shortTask, contactId, submissionId: null })),
        "none",
      );
      for (let step = 0; step < 5; step += 1) {
        const current = await getFileExportJobIn(db, eventId, job.id);
        if (current?.status === "completed" || current?.status === "failed") break;
        await processFileExportJobIn(db, eventId, job.id);
      }
      const finished = await getFileExportJobIn(db, eventId, job.id);
      expect(finished?.status).toBe("completed");
      expect(finished?.entryCount).toBe(3);

      const uploadId = [...exportR2Fake.uploads.keys()].at(-1);
      const parts = exportR2Fake.uploads.get(String(uploadId)) ?? [];
      // Every part but the last has to clear R2's floor.
      for (const part of parts.slice(0, -1)) {
        expect(part?.length ?? 0).toBeGreaterThanOrEqual(5 * 1024 * 1024);
      }
    });

    it("refuses a file the ZIP writer cannot hold, instead of a job that hangs forever", async () => {
      // A step materialises the whole object and the writer concats it twice
      // more — about three copies against a 128 MB isolate. Uploads are allowed
      // to 100 MB, so one large deck killed the isolate outright. That kills the
      // `catch` too, so the job was never marked `failed`: the lease expired,
      // the next poll re-claimed, and the banner read "Preparing export…" until
      // the row was pruned a day later, with no error ever shown.
      const hugeRequest = fileRequestIdSchema.parse("e5000000-0000-4000-8000-0000000000c0");
      const hugeTask = taskIdSchema.parse("e5000000-0000-4000-8000-0000000000c1");
      const hugeAsset = "e5000000-0000-4000-8000-0000000000c2";
      await pglite.query(
        "INSERT INTO file_requests(id,event_id,title,target_type,accepted_extensions,max_size_mb) VALUES($1,$2,'Huge deck','contact',ARRAY['pdf'],100)",
        [hugeRequest, eventId],
      );
      await pglite.query(
        "INSERT INTO portal_tasks(id,event_id,name,target_type,completion_mode,file_request_id) VALUES($1,$2,'Huge deck','contact','file_request',$3)",
        [hugeTask, eventId, hugeRequest],
      );
      await pglite.query(
        "INSERT INTO file_assets(id,event_id,kind,r2_key,filename,mime,size_bytes) VALUES($1,$2,'upload','huge/deck.bin','keynote.pdf','application/pdf',$3)",
        [hugeAsset, eventId, 60 * 1024 * 1024],
      );
      await pglite.query(
        "INSERT INTO file_uploads(event_id,file_request_id,contact_id,file_asset_id,version,is_latest) VALUES($1,$2,$3,$4,1,true)",
        [eventId, hugeRequest, ada, hugeAsset],
      );

      const { createFileExportJobIn } = await import("@/features/portal/deliverables/server/export");
      const jobsBefore = (await pglite.query<{ n: number }>("SELECT count(*)::int AS n FROM file_export_jobs WHERE event_id=$1", [eventId])).rows[0]?.n ?? 0;
      const refused = await createFileExportJobIn(
        db, eventId, null, [{ taskId: hugeTask, contactId: ada, submissionId: null }], "none",
      ).catch((thrown: unknown) => thrown);
      expect(isAppError(refused) && refused.code).toBe("VALIDATION");
      // Named, so the organizer knows which file to download on its own.
      expect(isAppError(refused) && refused.message).toContain("keynote.pdf");
      // And no job row was left behind to be polled.
      const jobsAfter = (await pglite.query<{ n: number }>("SELECT count(*)::int AS n FROM file_export_jobs WHERE event_id=$1", [eventId])).rows[0]?.n ?? 0;
      expect(jobsAfter).toBe(jobsBefore);

      await pglite.query("DELETE FROM file_uploads WHERE file_asset_id=$1", [hugeAsset]);
      await pglite.query("DELETE FROM file_assets WHERE id=$1", [hugeAsset]);
      await pglite.query("DELETE FROM portal_tasks WHERE id=$1", [hugeTask]);
      await pglite.query("DELETE FROM file_requests WHERE id=$1", [hugeRequest]);
    });

    it("does not rewind progress a second worker made after stealing this step's lease", async () => {
      const { createFileExportJobIn, processFileExportJobIn } = await import("@/features/portal/deliverables/server/export");
      const job = await createFileExportJobIn(
        db, eventId, null,
        [
          { taskId: bigTask, contactId: ada, submissionId: null },
          { taskId: bigTask, contactId: grace, submissionId: null },
          { taskId: bigTask, contactId: irene, submissionId: null },
        ],
        "none",
      );

      // A step reads whole objects from R2, so it can outrun its own 25-second
      // lease. Simulate that: while this step is reading bytes, another worker
      // re-claims the job and records progress of its own.
      let stolen = false;
      exportR2Fake.onGetObject = async () => {
        if (stolen) return;
        stolen = true;
        await pglite.query(
          `UPDATE file_export_jobs
           SET export_state = export_state || jsonb_build_object('claimedAt', now(), 'nextIndex', 3)
           WHERE id = $1`,
          [job.id],
        );
      };

      try {
        await processFileExportJobIn(db, eventId, job.id);
      } finally {
        exportR2Fake.onGetObject = null;
      }

      const after = await pglite.query<{ export_state: { nextIndex: number } }>(
        "SELECT export_state FROM file_export_jobs WHERE id = $1", [job.id],
      );
      expect(stolen).toBe(true);
      // The stale step's own `nextIndex` of 2 must not overwrite the newer
      // worker's 3 — that would re-read files already accounted for and orphan
      // the multipart parts the newer worker had uploaded.
      expect(after.rows[0]?.export_state.nextIndex).toBe(3);
    });

    it("rescues a job whose very first step never ran", async () => {
      const { createFileExportJobIn, getFileExportJobIn, nudgeStalledFileExportsIn } = await import("@/features/portal/deliverables/server/export");
      // The POST route starts step one through `ctx.waitUntil(...).catch(() =>
      // undefined)`. If that never runs — no Worker context, or a transient
      // failure it swallows — the job sits `pending` with nobody polling it.
      // That is precisely the "closed browser tab" case this sweep is for, and
      // filtering on `processing` alone made it the one case it could not fix.
      const job = await createFileExportJobIn(
        db, eventId, null, [{ taskId: bigTask, contactId: irene, submissionId: null }], "none",
      );
      expect(job.status).toBe("pending");

      const swept = await nudgeStalledFileExportsIn(db);

      expect(swept.nudged).toBeGreaterThan(0);
      expect((await getFileExportJobIn(db, eventId, job.id))?.status).not.toBe("pending");
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
