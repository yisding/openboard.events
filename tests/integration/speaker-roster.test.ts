import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbOrTx, TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import { requestPortalLoginIn } from "@/features/auth";
import { getSpeakerRosterExtrasIn } from "@/features/portal/server/speaker-roster-queries";
import {
  createLogisticsFieldIn,
  createSpeakerIn,
  importSpeakersCsvIn,
  replaceSpeakerUnavailabilityIn,
  updateSpeakerProfileIn,
} from "@/features/portal/server/speaker-roster-mutations";
import { listSpeakerUnavailabilityIn, listSpeakerUploadsIn } from "@/features/portal/server/speaker-roster-queries";
import { contactIdSchema, eventIdSchema } from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";

const migration0 = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");
// M52 added `file_uploads.version`/`is_latest`, which `listSpeakerUploadsIn`
// reads (the "uploaded-asset visibility" AC needs the *latest* version only).
const migrationDeliverables = readFileSync(new URL("../../drizzle/0006_content_deliverables.sql", import.meta.url), "utf8");
const migrationRoster = readFileSync(new URL("../../drizzle/0008_speaker_roster_operations.sql", import.meta.url), "utf8");
// M59 (drizzle/0016) added `contacts.acceptance_seen_at`. This harness applies
// a hand-picked subset of migrations rather than the whole journal, so any
// drizzle query that names every declared `contacts` column — an unqualified
// `.returning()`, or a `select()` of the whole table — fails against a
// database built without it. Applied last, as it is in the journal.
const migrationSpeakerMoments = readFileSync(new URL("../../drizzle/0016_speaker_moments.sql", import.meta.url), "utf8");

const eventId = eventIdSchema.parse("d1000000-0000-4000-8000-000000000001");
const otherEventId = eventIdSchema.parse("d1000000-0000-4000-8000-000000000002");

let pglite: PGlite;
let db: DbOrTx;

describe("speaker roster operations (M51)", () => {
  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migration0);
    await pglite.exec(migration1);
    await pglite.exec(migrationDeliverables);
    await pglite.exec(migrationRoster);
    await pglite.exec(migrationSpeakerMoments);
    db = drizzle(pglite, { schema }) as unknown as DbOrTx;

    await pglite.query(
      "INSERT INTO events(id,name,slug,timezone,starts_at,ends_at) VALUES($1,'Test Event','roster-event','America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
      [eventId],
    );
    await pglite.query(
      "INSERT INTO events(id,name,slug,timezone,starts_at,ends_at) VALUES($1,'Other Event','other-roster-event','America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
      [otherEventId],
    );
  }, 30_000);

  afterAll(async () => pglite.close());

  it("creates a speaker manually and persists a full profile/workflow edit", async () => {
    const contactId = await createSpeakerIn(db, eventId, {
      email: "Ada@Example.com",
      firstName: "Ada",
      lastName: "Lovelace",
      jobTitle: "Engineer",
      company: "Acme",
      workflowStatus: "contacted",
    });
    const extras = await getSpeakerRosterExtrasIn(db, eventId, contactId);
    expect(extras?.workflowStatus).toBe("contacted");

    const [row] = await pglite.query<{ email: string; first_name: string; job_title: string }>(
      "SELECT email, first_name, job_title FROM contacts WHERE id=$1", [contactId],
    ).then((result) => result.rows);
    // Normalized like every other contact entry point (resolution #13).
    expect(row?.email).toBe("ada@example.com");
    expect(row?.first_name).toBe("Ada");
    expect(row?.job_title).toBe("Engineer");

    await updateSpeakerProfileIn(db, eventId, contactId, { company: "Acme Corp", workflowStatus: "confirmed" });
    const afterEdit = await getSpeakerRosterExtrasIn(db, eventId, contactId);
    expect(afterEdit?.workflowStatus).toBe("confirmed");
  });

  it("creates a logistics field and round-trips a per-contact value through updateSpeakerProfileIn", async () => {
    const contactId = await createSpeakerIn(db, eventId, { email: "grace@example.com" });
    const field = await createLogisticsFieldIn(db, eventId, { key: "shirt_size", label: "Shirt size", fieldType: "select", options: ["S", "M", "L"] });

    await updateSpeakerProfileIn(db, eventId, contactId, { logisticsValues: { [field.id]: "M" } });
    const extras = await getSpeakerRosterExtrasIn(db, eventId, contactId);
    expect(extras?.fields.map((row) => row.key)).toContain("shirt_size");
    expect(extras?.values).toEqual([{ fieldId: field.id, value: "M" }]);

    // Overwrite is a single guarded upsert, not a second row.
    await updateSpeakerProfileIn(db, eventId, contactId, { logisticsValues: { [field.id]: "L" } });
    const updated = await getSpeakerRosterExtrasIn(db, eventId, contactId);
    expect(updated?.values).toEqual([{ fieldId: field.id, value: "L" }]);
  });

  it("rejects a logistics value for a field id from another event", async () => {
    const contactId = await createSpeakerIn(db, eventId, { email: "morgan@example.com" });
    const otherField = await createLogisticsFieldIn(db, otherEventId, { key: "diet", label: "Dietary needs", fieldType: "text", options: [] });
    await expect(updateSpeakerProfileIn(db, eventId, contactId, { logisticsValues: { [otherField.id]: "vegan" } }))
      .rejects.toSatisfy((error: unknown) => isAppError(error) && error.code === "VALIDATION");
  });

  it("adds a blackout in one call, reads it back unchanged in UTC, and a full replace is atomic", async () => {
    const contactId = await createSpeakerIn(db, eventId, { email: "priya@example.com" });
    // "9am-11am Pacific on event day two" entered in the event timezone,
    // already converted to UTC ISO by the caller (the editor does this
    // client-side against the event's stored timezone).
    const inserted = await replaceSpeakerUnavailabilityIn(db, eventId, contactId, [
      { startsAt: "2026-09-16T16:00:00.000Z", endsAt: "2026-09-16T18:00:00.000Z", reason: "Flight" },
    ]);
    expect(inserted).toHaveLength(1);

    const readBack = await listSpeakerUnavailabilityIn(db, eventId, [contactId]);
    expect(readBack).toEqual([expect.objectContaining({
      contactId,
      startsAt: "2026-09-16T16:00:00.000Z",
      endsAt: "2026-09-16T18:00:00.000Z",
      reason: "Flight",
    })]);

    // A second full-set replace with two different intervals leaves exactly
    // those two — the delete+insert CTE never leaves the old row behind.
    const replaced = await replaceSpeakerUnavailabilityIn(db, eventId, contactId, [
      { startsAt: "2026-09-15T20:00:00.000Z", endsAt: "2026-09-15T22:00:00.000Z" },
      { startsAt: "2026-09-16T20:00:00.000Z", endsAt: "2026-09-16T22:00:00.000Z", reason: "Dinner" },
    ]);
    expect(replaced).toHaveLength(2);
    expect(await listSpeakerUnavailabilityIn(db, eventId, [contactId])).toHaveLength(2);

    // An empty replace clears the set entirely — "no rows means no declared
    // blackout" (work order).
    await replaceSpeakerUnavailabilityIn(db, eventId, contactId, []);
    expect(await listSpeakerUnavailabilityIn(db, eventId, [contactId])).toEqual([]);
  });

  it("rejects an interval where end is not after start", async () => {
    const contactId = await createSpeakerIn(db, eventId, { email: "backwards@example.com" });
    // The CHECK constraint is the backstop; the zod schema (exercised at the
    // route) is the primary guard — this proves the backstop independently.
    await expect(replaceSpeakerUnavailabilityIn(db, eventId, contactId, [
      { startsAt: "2026-09-16T18:00:00.000Z", endsAt: "2026-09-16T16:00:00.000Z" },
    ])).rejects.toThrow();
  });

  describe("CSV import", () => {
    const mapping = { email: 0, fields: { firstName: 1, company: 2 } };

    it("imports two existing emails plus one new row without duplicates, names every proposed change, and commits exactly once on retry", async () => {
      const existingFilled = await createSpeakerIn(db, eventId, { email: "filled@example.com", company: "Already Set Inc" });
      const existingBlank = await createSpeakerIn(db, eventId, { email: "blank@example.com" });

      const csvText = [
        "Email,First name,Company",
        "filled@example.com,Filled,New Company That Should Not Land",
        "blank@example.com,Blank,New Company",
        "new@example.com,Newperson,New Co",
      ].join("\r\n");

      const preview = await importSpeakersCsvIn(db, eventId, { csvText, mapping, mode: "preview" });
      expect(preview.valid).toBe(3);
      expect(preview.invalid).toBe(0);
      expect(preview.committed).toBe(0);
      const filledPreviewRow = preview.rows.find((row) => row.email === "filled@example.com");
      // The organizer's own "Already Set Inc" is non-empty, so company is
      // NOT in the proposed changes even though the CSV carries a value.
      expect(filledPreviewRow?.changedFields).toEqual(["firstName"]);
      const blankPreviewRow = preview.rows.find((row) => row.email === "blank@example.com");
      expect(blankPreviewRow?.changedFields.sort()).toEqual(["company", "firstName"]);

      const commit = await importSpeakersCsvIn(db, eventId, { csvText, mapping, mode: "commit" });
      expect(commit.committed).toBe(3);

      const contactCount = await pglite.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM contacts WHERE event_id=$1 AND email IN ('filled@example.com','blank@example.com','new@example.com')",
        [eventId],
      );
      expect(contactCount.rows[0]?.n).toBe(3); // no duplicates created

      const filledRow = await pglite.query<{ company: string; first_name: string }>(
        "SELECT company, first_name FROM contacts WHERE id=$1", [existingFilled],
      );
      expect(filledRow.rows[0]).toEqual({ company: "Already Set Inc", first_name: "Filled" });

      const blankRow = await pglite.query<{ company: string; first_name: string }>(
        "SELECT company, first_name FROM contacts WHERE id=$1", [existingBlank],
      );
      expect(blankRow.rows[0]).toEqual({ company: "New Company", first_name: "Blank" });

      // Retrying the exact same commit is idempotent: no new contacts, and no
      // error, because every field the row would still change is already
      // empty-free (nothing left to fill) — "committed exactly once" holds
      // even though the row is processed twice.
      const retry = await importSpeakersCsvIn(db, eventId, { csvText, mapping, mode: "commit" });
      expect(retry.committed).toBe(3);
      const contactCountAfterRetry = await pglite.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM contacts WHERE event_id=$1 AND email IN ('filled@example.com','blank@example.com','new@example.com')",
        [eventId],
      );
      expect(contactCountAfterRetry.rows[0]?.n).toBe(3);
    });

    it("reports row-level errors for invalid/missing emails and a duplicate within the file, without writing them", async () => {
      const csvText = [
        "Email,First name",
        "not-an-email,Bad",
        ",Blank Email",
        "dup@example.com,First",
        "dup@example.com,Second",
      ].join("\r\n");
      const preview = await importSpeakersCsvIn(db, eventId, { csvText, mapping: { email: 0, fields: { firstName: 1 } }, mode: "preview" });
      // Only the first `dup@example.com` occurrence is "ok"/valid; the two
      // bad-email rows and the second `dup@example.com` occurrence are not.
      expect(preview.valid).toBe(1);
      expect(preview.invalid).toBe(3);
      expect(preview.rows.map((row) => row.status)).toEqual(["error", "error", "ok", "duplicate_in_file"]);

      const commit = await importSpeakersCsvIn(db, eventId, { csvText, mapping: { email: 0, fields: { firstName: 1 } }, mode: "commit" });
      expect(commit.committed).toBe(1); // only the first `dup@example.com` row
      const count = await pglite.query<{ n: number }>("SELECT count(*)::int AS n FROM contacts WHERE event_id=$1 AND email='dup@example.com'", [eventId]);
      expect(count.rows[0]?.n).toBe(1);
    });
  });

  it("lists an organizer-visible uploaded asset scoped to its event, and never a latest=false superseded version", async () => {
    const contactId = await createSpeakerIn(db, eventId, { email: "uploader@example.com" });
    const requestId = "d1000000-0000-4000-8000-0000000000a0";
    const oldAssetId = "d1000000-0000-4000-8000-0000000000a1";
    const newAssetId = "d1000000-0000-4000-8000-0000000000a2";
    const oldUploadId = "d1000000-0000-4000-8000-0000000000a3";
    const newUploadId = "d1000000-0000-4000-8000-0000000000a4";

    await pglite.query(
      "INSERT INTO file_requests(id,event_id,title) VALUES($1,$2,'Slides')",
      [requestId, eventId],
    );
    await pglite.query(
      "INSERT INTO file_assets(id,event_id,kind,r2_key,filename,mime,size_bytes,uploaded_by_contact_id) VALUES($1,$2,'attachment','staging/old.pdf','old.pdf','application/pdf',100,$3)",
      [oldAssetId, eventId, contactId],
    );
    await pglite.query(
      "INSERT INTO file_assets(id,event_id,kind,r2_key,filename,mime,size_bytes,uploaded_by_contact_id) VALUES($1,$2,'attachment','staging/new.pdf','slides-final.pdf','application/pdf',200,$3)",
      [newAssetId, eventId, contactId],
    );
    await pglite.query(
      "INSERT INTO file_uploads(id,event_id,file_request_id,contact_id,file_asset_id,version,is_latest) VALUES($1,$2,$3,$4,$5,1,false)",
      [oldUploadId, eventId, requestId, contactId, oldAssetId],
    );
    await pglite.query(
      "INSERT INTO file_uploads(id,event_id,file_request_id,contact_id,file_asset_id,version,is_latest) VALUES($1,$2,$3,$4,$5,2,true)",
      [newUploadId, eventId, requestId, contactId, newAssetId],
    );

    const uploads = await listSpeakerUploadsIn(db, eventId, contactId);
    expect(uploads).toEqual([expect.objectContaining({
      fileId: newAssetId,
      filename: "slides-final.pdf",
      mime: "application/pdf",
      sizeBytes: 200,
      requestTitle: "Slides",
    })]);
    expect(uploads.map((row) => row.fileId)).not.toContain(oldAssetId);
  });

  it("never surfaces a contact or its uploads/unavailability from another event", async () => {
    const otherContact = await createSpeakerIn(db, otherEventId, { email: "elsewhere@example.com" });
    expect(await getSpeakerRosterExtrasIn(db, eventId, contactIdSchema.parse(otherContact))).toBeNull();
    expect(await listSpeakerUnavailabilityIn(db, eventId, [otherContact])).toEqual([]);
    expect(await listSpeakerUploadsIn(db, eventId, otherContact)).toEqual([]);
  });

  it("invites a speaker through the exact M06b login-challenge path and enqueues a log row", async () => {
    const contactId = await createSpeakerIn(db, eventId, { email: "invitee@example.com", firstName: "Invitee" });
    const result = await requestPortalLoginIn(db as unknown as TxDb, {
      eventId,
      eventSlug: "roster-event",
      email: "invitee@example.com",
      appBaseUrl: "http://localhost:3000",
      sessionSecret: "invite-test-secret-that-is-at-least-32-bytes",
      fallback: false,
    });
    expect(result.message).toContain("we've sent a code");
    const rows = await pglite.query<{ template_key: string; status: string }>(
      "SELECT template_key, status FROM communication_logs WHERE contact_id=$1", [contactId],
    );
    expect(rows.rows).toEqual([{ template_key: "portal_login", status: "queued" }]);
  });
});
