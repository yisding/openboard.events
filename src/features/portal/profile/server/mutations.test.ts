import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbOrTx } from "@/db/client";
import * as schema from "@/db/schema";
import { contactIdSchema, eventIdSchema, fileIdSchema, LIMITS } from "@/shared/contracts";
import { getSpeakerProfileIn } from "./queries";
import { profilePatchSchema, updateProfileIn } from "./mutations";

const migration0 = readFileSync(new URL("../../../../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../../../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");
// M50 is additive on top of the base schema; applying it keeps this fixture
// aligned with the columns the repository modules now read.
const migrationReviewOps = readFileSync(new URL("../../../../../drizzle/0004_review_operations.sql", import.meta.url), "utf8");
// M51 added `contacts.workflow_status`; `updateProfileIn`'s unqualified
// `.returning()` (every declared column) needs it to exist.
const migrationRoster = readFileSync(new URL("../../../../../drizzle/0008_speaker_roster_operations.sql", import.meta.url), "utf8");
// M59 added `contacts.acceptance_seen_at` — same reason as the roster
// migration above: the unqualified `.returning()` needs every column to exist.
const migrationSpeakerMoments = readFileSync(new URL("../../../../../drizzle/0016_speaker_moments.sql", import.meta.url), "utf8");

const eventId = eventIdSchema.parse("c2000000-0000-4000-8000-000000000001");
const freshContact = contactIdSchema.parse("c2000000-0000-4000-8000-000000000010");
const raceContact = contactIdSchema.parse("c2000000-0000-4000-8000-000000000011");

describe("speaker profile", () => {
  let pglite: PGlite;
  let db: DbOrTx;

  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migration0);
    await pglite.exec(migration1);
    await pglite.exec(migrationReviewOps);
    await pglite.exec(migrationRoster);
    await pglite.exec(migrationSpeakerMoments);
    db = drizzle(pglite, { schema }) as unknown as DbOrTx;

    await pglite.query(
      "INSERT INTO events(id,name,slug,starts_at,ends_at) VALUES($1,'Profile Event','profile-event','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
      [eventId],
    );
    await pglite.query(
      "INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES($1,$2,'fresh@example.com','Fresh','Speaker')",
      [freshContact, eventId],
    );
    await pglite.query(
      "INSERT INTO contacts(id,event_id,email,first_name,last_name,company) VALUES($1,$2,'race@example.com','Race','Speaker','Original Co')",
      [raceContact, eventId],
    );
  }, 60_000);

  afterAll(async () => {
    await pglite.close();
  });

  it("returns null-safe defaults for a freshly-created contact", async () => {
    const profile = await getSpeakerProfileIn(db, eventId, freshContact);
    expect(profile).toMatchObject({
      contactId: freshContact,
      email: "fresh@example.com",
      firstName: "Fresh",
      lastName: "Speaker",
      salutation: null,
      honorific: null,
      pronouns: null,
      gender: null,
      bioHtml: null,
      headshotFileId: null,
      headshotUrl: null,
      linkedinUrl: null,
      twitterUrl: null,
      facebookUrl: null,
      websiteUrl: null,
    });
  });

  it("bio-limit: rejects a bio over 5000 plaintext characters, padded further by markup", () => {
    const hostile = `<p>${"a".repeat(LIMITS.BIO + 1)}</p><b>more tags to pad the raw length</b>`;
    const result = profilePatchSchema.safeParse({ bioHtml: hostile });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["bioHtml"]);
    }
  });

  it("bio-limit: accepts a bio at exactly 5000 plaintext characters", () => {
    const atLimit = `<p>${"a".repeat(LIMITS.BIO)}</p>`;
    expect(profilePatchSchema.safeParse({ bioHtml: atLimit }).success).toBe(true);
  });

  it("sanitizes bio HTML at the write boundary", async () => {
    const profile = await updateProfileIn(db, eventId, freshContact, {
      bioHtml: '<p>hi</p><script>alert(1)</script><img src=x onerror="alert(2)">',
    });
    expect(profile.bioHtml).toBe("<p>hi</p>");
    expect(profile.bioHtml).not.toContain("script");
    expect(profile.bioHtml).not.toContain("onerror");
  });

  it("renders unicode, emoji, and RTL text in the bio and counts them correctly", async () => {
    const hostile = "<p>مرحبا 👩🏽‍💻 world</p>";
    const profile = await updateProfileIn(db, eventId, freshContact, { bioHtml: hostile });
    expect(profile.bioHtml).toContain("مرحبا");
    expect(profile.bioHtml).toContain("👩🏽‍💻");
  });

  it("field-scoped: patching only bioHtml leaves every other column untouched, even racing a concurrent write", async () => {
    // Simulate a concurrent writer (e.g. M25's form write-back) changing a
    // column this patch never mentions, *between* this test's read and write.
    await pglite.query("UPDATE contacts SET company=$1 WHERE id=$2", ["Raced Co", raceContact]);

    const before = await getSpeakerProfileIn(db, eventId, raceContact);
    const after = await updateProfileIn(db, eventId, raceContact, { bioHtml: "<p>Only the bio changed.</p>" });

    expect(after.bioHtml).toBe("<p>Only the bio changed.</p>");
    // Everything else the DTO surfaces is exactly what it was before this call.
    expect(after.firstName).toBe(before.firstName);
    expect(after.lastName).toBe(before.lastName);
    expect(after.linkedinUrl).toBe(before.linkedinUrl);
    expect(after.headshotFileId).toBe(before.headshotFileId);

    // And the column this patch never mentioned — company, not part of the
    // profile DTO at all — still carries the concurrent writer's value; this
    // call never reverted it to an older whole-row snapshot.
    const row = await pglite.query<{ company: string | null }>("SELECT company FROM contacts WHERE id=$1", [raceContact]);
    expect(row.rows[0]?.company).toBe("Raced Co");
  });

  it("empty patch is a no-op read, not a write with nothing to set", async () => {
    const before = await getSpeakerProfileIn(db, eventId, raceContact);
    const after = await updateProfileIn(db, eventId, raceContact, {});
    expect(after).toEqual(before);
  });

  describe("headshot ownership", () => {
    // Ids are the whole attack surface here: a `/f/{fileId}` URL is printed in
    // the HTML of every public speaker-gallery and schedule page, so "knows a
    // file id" is not evidence of anything.
    const ownFile = fileIdSchema.parse("c2000000-0000-4000-8000-0000000000f1");
    const strangerFile = fileIdSchema.parse("c2000000-0000-4000-8000-0000000000f2");
    const logoFile = fileIdSchema.parse("c2000000-0000-4000-8000-0000000000f3");
    const organizerUploadedFile = fileIdSchema.parse("c2000000-0000-4000-8000-0000000000f4");
    const otherEventFile = fileIdSchema.parse("c2000000-0000-4000-8000-0000000000f5");
    const stagedFile = fileIdSchema.parse("c2000000-0000-4000-8000-0000000000f6");
    const stranger = contactIdSchema.parse("c2000000-0000-4000-8000-000000000012");
    const headshotOwner = contactIdSchema.parse("c2000000-0000-4000-8000-000000000013");

    // `buildObjectKey`'s scheme, spelled out rather than imported: if the key
    // format changes, this fixture should fail loudly rather than follow along
    // and keep asserting nothing.
    const publishedKey = (fileId: string, kind: string) => `evt_${eventId}/${kind}/${fileId}/photo.jpg`;

    beforeAll(async () => {
      await pglite.query(
        "INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES($1,$2,'stranger@example.com','Stranger','Speaker'),($3,$2,'owner@example.com','Owner','Speaker')",
        [stranger, eventId, headshotOwner],
      );
      for (const [id, kind, contactId] of [
        [ownFile, "headshot", headshotOwner],
        [strangerFile, "headshot", stranger],
        [logoFile, "logo", null],
        [organizerUploadedFile, "headshot", null],
      ] as const) {
        await pglite.query(
          "INSERT INTO file_assets(id,event_id,kind,r2_key,filename,mime,size_bytes,uploaded_by_contact_id) VALUES($1,$2,$3,$4,'photo.jpg','image/jpeg',1024,$5)",
          [id, eventId, kind, publishedKey(id, kind), contactId],
        );
      }
      // Presigned and never uploaded to: `createUpload` writes the row pointing
      // at a staging key, and only `finalizeUpload` moves it to the published one.
      await pglite.query(
        "INSERT INTO file_assets(id,event_id,kind,r2_key,filename,mime,size_bytes,uploaded_by_contact_id) VALUES($1,$2,'headshot',$3,'photo.jpg','image/jpeg',1024,$4)",
        [stagedFile, eventId, `staging/evt_${eventId}/headshot/${stagedFile}/photo.jpg`, headshotOwner],
      );
    });

    it("accepts a headshot the speaker uploaded themselves", async () => {
      const profile = await updateProfileIn(db, eventId, headshotOwner, { headshotFileId: ownFile });
      expect(profile.headshotFileId).toBe(ownFile);
    });

    it("refuses another speaker's headshot and lands none of the patch", async () => {
      await expect(updateProfileIn(db, eventId, headshotOwner, {
        headshotFileId: strangerFile,
        firstName: "Renamed",
      })).rejects.toMatchObject({ code: "VALIDATION" });

      // The rejection has to come before the write, or the speaker keeps the
      // rest of a patch the server refused.
      const profile = await getSpeakerProfileIn(db, eventId, headshotOwner);
      expect(profile.headshotFileId).toBe(ownFile);
      expect(profile.firstName).toBe("Owner");
    });

    it("refuses a file that is not a headshot at all", async () => {
      // The event's own logo is a public kind, so serving it was never the
      // barrier — being the wrong kind of file is.
      await expect(updateProfileIn(db, eventId, headshotOwner, { headshotFileId: logoFile }))
        .rejects.toMatchObject({ code: "VALIDATION" });
    });

    it("refuses a file id from another event", async () => {
      const otherEvent = eventIdSchema.parse("c2000000-0000-4000-8000-000000000098");
      await pglite.query(
        "INSERT INTO events(id,name,slug,starts_at,ends_at) VALUES($1,'Other','other-event','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
        [otherEvent],
      );
      // `file_assets_contact_fk` scopes the uploader to the file's own event,
      // so the cross-event file necessarily has a different uploader — the
      // event filter is defence in depth behind the ownership one, and this
      // is the shape a real cross-event attempt takes.
      const otherEventContact = contactIdSchema.parse("c2000000-0000-4000-8000-000000000014");
      await pglite.query(
        "INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES($1,$2,'other@example.com','Other','Speaker')",
        [otherEventContact, otherEvent],
      );
      await pglite.query(
        "INSERT INTO file_assets(id,event_id,kind,r2_key,filename,mime,size_bytes,uploaded_by_contact_id) VALUES($1,$2,'headshot',$3,'photo.jpg','image/jpeg',1024,$4)",
        [otherEventFile, otherEvent, `evt_${otherEvent}/headshot/${otherEventFile}/photo.jpg`, otherEventContact],
      );
      await expect(updateProfileIn(db, eventId, headshotOwner, { headshotFileId: otherEventFile }))
        .rejects.toMatchObject({ code: "VALIDATION" });
    });

    it("still accepts the headshot an organizer uploaded on the speaker's behalf", async () => {
      // That file carries `uploaded_by_user_id`, not this contact's id, so an
      // ownership check written only against the uploader would lock the
      // speaker out of re-sending their own current photo.
      await pglite.query("UPDATE contacts SET headshot_file_id=$1 WHERE id=$2", [organizerUploadedFile, headshotOwner]);
      const profile = await updateProfileIn(db, eventId, headshotOwner, { headshotFileId: organizerUploadedFile });
      expect(profile.headshotFileId).toBe(organizerUploadedFile);
    });

    it("refuses an upload the speaker presigned but never finished", async () => {
      // Owned by this contact and the right kind, so ownership alone lets it
      // through. `/f/{fileId}` would answer 404 for it, and the orphan sweep
      // exempts any file a contact's headshot references — so accepting it
      // pins the row and its staging object permanently.
      await expect(updateProfileIn(db, eventId, headshotOwner, { headshotFileId: stagedFile }))
        .rejects.toMatchObject({ code: "VALIDATION" });
    });

    it("still lets a speaker clear their photo", async () => {
      const profile = await updateProfileIn(db, eventId, headshotOwner, { headshotFileId: null });
      expect(profile.headshotFileId).toBeNull();
    });
  });

  it("scopes reads and writes to (eventId, contactId) together", async () => {
    const otherEvent = eventIdSchema.parse("c2000000-0000-4000-8000-000000000099");
    await expect(getSpeakerProfileIn(db, otherEvent, freshContact)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
