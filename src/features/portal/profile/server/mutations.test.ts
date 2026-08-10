import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbOrTx } from "@/db/client";
import * as schema from "@/db/schema";
import { contactIdSchema, eventIdSchema, LIMITS } from "@/shared/contracts";
import { getSpeakerProfileIn } from "./queries";
import { profilePatchSchema, updateProfileIn } from "./mutations";

const migration0 = readFileSync(new URL("../../../../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../../../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");

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

  it("scopes reads and writes to (eventId, contactId) together", async () => {
    const otherEvent = eventIdSchema.parse("c2000000-0000-4000-8000-000000000099");
    await expect(getSpeakerProfileIn(db, otherEvent, freshContact)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
