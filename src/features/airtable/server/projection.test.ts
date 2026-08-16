import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbOrTx } from "@/db/client";
import * as schema from "@/db/schema";
import { eventIdSchema } from "@/shared/contracts";
import { SYNC_TABLE_ORDER, TABLE_PLANS } from "../plan";
import { candidateRecordsIn, orphanRecordsIn, recordSyncedRowsIn, syncedRowCountIn } from "./projection";

const migration0 = readFileSync(new URL("../../../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration52 = readFileSync(new URL("../../../../drizzle/0052_airtable_connections.sql", import.meta.url), "utf8");

const eventId = eventIdSchema.parse("a17b0000-0000-4000-8000-0000000000e1");
const trackId = "a17b0000-0000-4000-8000-0000000000a1";
const contactId = "a17b0000-0000-4000-8000-0000000000c1";
const sessionId = "a17b0000-0000-4000-8000-0000000000b1";
const roomGhostId = "a17b0000-0000-4000-8000-0000000000d9";

const OPTIONS = { includeEmail: true, includeBio: true, includePronouns: false, includeGender: false, pruneRemoved: false };

let pglite: PGlite;
let db: DbOrTx;

describe("Airtable projection (M39)", () => {
  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migration0);
    await pglite.exec(migration52);
    db = drizzle(pglite, { schema }) as unknown as DbOrTx;
    await pglite.query(
      "INSERT INTO events(id,name,slug,timezone,starts_at,ends_at) VALUES($1,'E','e1','UTC','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
      [eventId],
    );
    await pglite.query("INSERT INTO tracks(id,event_id,name) VALUES($1,$2,'Platform')", [trackId, eventId]);
    await pglite.query("INSERT INTO contacts(id,event_id,email,first_name,last_name,bio_html) VALUES($1,$2,'a@b.co','Ada','Lovelace','<p>Hi &amp; hello</p>')", [contactId, eventId]);
    await pglite.query("INSERT INTO sessions(id,event_id,title,slug,track_id) VALUES($1,$2,'Talk','talk',$3)", [sessionId, eventId, trackId]);
    await pglite.query("INSERT INTO session_speakers(event_id,session_id,contact_id) VALUES($1,$2,$3)", [eventId, sessionId, contactId]);
  }, 60_000);

  afterAll(async () => pglite.close());
  it("runs every table's candidate and orphan query", async () => {
    for (const key of SYNC_TABLE_ORDER) {
      const candidates = await candidateRecordsIn(db, eventId, key, OPTIONS, 50);
      expect(candidates.total).toBeGreaterThanOrEqual(0);
      for (const row of candidates.rows) {
        expect(Object.keys(row.fields).sort()).toEqual(TABLE_PLANS[key].fields.map((f) => f.name).sort());
        expect(row.contentHash).toMatch(/^[0-9a-f]{64}$/u);
      }
      const orphans = await orphanRecordsIn(db, eventId, key, 50);
      expect(orphans.orphanTotal).toBe(0);
    }
  });

  it("hashes identically twice and flips when a joined label changes", async () => {
    const first = await candidateRecordsIn(db, eventId, "sessions", OPTIONS, 50);
    const second = await candidateRecordsIn(db, eventId, "sessions", OPTIONS, 50);
    expect(first.rows[0]?.contentHash).toBe(second.rows[0]?.contentHash);
    expect(first.rows[0]?.fields.Track).toEqual([]);

    await recordSyncedRowsIn(db, eventId, "tracks", [{ recordPk: trackId, airtableRecordId: "rec1", contentHash: "h" }]);
    const third = await candidateRecordsIn(db, eventId, "sessions", OPTIONS, 50);
    expect(third.rows[0]?.fields.Track).toEqual(["rec1"]);
    expect(third.rows[0]?.contentHash).not.toBe(first.rows[0]?.contentHash);
    expect(await syncedRowCountIn(db, eventId, "tracks")).toBe(1);
  });

  it("strips HTML and decodes entities in bio", async () => {
    const people = await candidateRecordsIn(db, eventId, "people", OPTIONS, 50);
    expect(people.rows[0]?.fields.Bio).toBe("Hi & hello");
    expect(people.rows[0]?.fields.Name).toBe("Ada Lovelace");
    const gated = await candidateRecordsIn(db, eventId, "people", { ...OPTIONS, includeEmail: false }, 50);
    expect(gated.rows[0]?.fields.Email).toBeNull();
  });

  it("skips rows whose hash already matches, and reports orphans", async () => {
    const before = await candidateRecordsIn(db, eventId, "tracks", OPTIONS, 50);
    await recordSyncedRowsIn(db, eventId, "tracks", before.rows.map((row) => ({
      recordPk: row.recordPk, airtableRecordId: "rec1", contentHash: row.contentHash,
    })));
    const after = await candidateRecordsIn(db, eventId, "tracks", OPTIONS, 50);
    expect(after.rows).toHaveLength(0);
    expect(after.total).toBe(0);

    await recordSyncedRowsIn(db, eventId, "rooms", [{ recordPk: roomGhostId, airtableRecordId: "recGone", contentHash: "x" }]);
    const orphans = await orphanRecordsIn(db, eventId, "rooms", 50);
    expect(orphans.orphanTotal).toBe(1);
    expect(orphans.stateTotal).toBe(1);
    expect(orphans.rows[0]?.airtableRecordId).toBe("recGone");
  });

  it("a track rename does not flip a linked session's hash — the link carries a resolved record id, not the track's label", async () => {
    // Airtable renders a multipleRecordLinks chip from the linked record's own
    // current primary field, live. A session's projected 'Track' value is the
    // resolved Airtable record id, so a rename that leaves that id untouched
    // must not flip the session's hash — Airtable already shows the new name.
    const before = await candidateRecordsIn(db, eventId, "sessions", OPTIONS, 50);
    const beforeHash = before.rows.find((row) => row.recordPk === sessionId)?.contentHash;
    await pglite.query("UPDATE tracks SET name = 'Renamed track' WHERE id = $1", [trackId]);
    const after = await candidateRecordsIn(db, eventId, "sessions", OPTIONS, 50);
    const afterHash = after.rows.find((row) => row.recordPk === sessionId)?.contentHash;
    expect(afterHash).toBe(beforeHash);

    // The track's own row, meanwhile, does change — its own Name field moved.
    const tracks = await candidateRecordsIn(db, eventId, "tracks", OPTIONS, 50);
    expect(tracks.rows.find((row) => row.recordPk === trackId)?.fields.Name).toBe("Renamed track");
  });

  it("speaker order is part of the hash, but only the logical order — physical row order is not", async () => {
    const speakerBId = "a17b0000-0000-4000-8000-0000000000c2";
    const speakerCId = "a17b0000-0000-4000-8000-0000000000c3";
    await pglite.query("INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES($1,$2,'b@b.co','Bea','Speaker'),($3,$2,'c@c.co','Cai','Speaker')", [speakerBId, eventId, speakerCId]);
    await pglite.query("INSERT INTO session_speakers(event_id,session_id,contact_id,sort_order) VALUES($1,$2,$3,1),($1,$2,$4,2)", [eventId, sessionId, speakerBId, speakerCId]);
    // The Speakers aggregate only picks up a speaker whose Airtable record id
    // is already known, so every speaker in this test needs a "people" state
    // row before the aggregate has anything to order.
    await recordSyncedRowsIn(db, eventId, "people", [
      { recordPk: contactId, airtableRecordId: "recSpeakerA", contentHash: "h" },
      { recordPk: speakerBId, airtableRecordId: "recSpeakerB", contentHash: "h" },
      { recordPk: speakerCId, airtableRecordId: "recSpeakerC", contentHash: "h" },
    ]);

    const ordered = await candidateRecordsIn(db, eventId, "sessions", OPTIONS, 50);
    const orderedHash = ordered.rows.find((row) => row.recordPk === sessionId)?.contentHash;

    // Same three speakers, swapped logical order — the hash must change.
    await pglite.query("UPDATE session_speakers SET sort_order = 3 WHERE event_id = $1 AND session_id = $2 AND contact_id = $3", [eventId, sessionId, contactId]);
    const reordered = await candidateRecordsIn(db, eventId, "sessions", OPTIONS, 50);
    const reorderedHash = reordered.rows.find((row) => row.recordPk === sessionId)?.contentHash;
    expect(reorderedHash).not.toBe(orderedHash);

    // Put the logical order back, but land the rows in a different physical
    // insertion order this time — the hash must return to what it was.
    await pglite.query("DELETE FROM session_speakers WHERE event_id = $1 AND session_id = $2", [eventId, sessionId]);
    await pglite.query(
      "INSERT INTO session_speakers(event_id,session_id,contact_id,sort_order) VALUES($1,$2,$3,2),($1,$2,$4,0),($1,$2,$5,1)",
      [eventId, sessionId, speakerCId, contactId, speakerBId],
    );
    const restored = await candidateRecordsIn(db, eventId, "sessions", OPTIONS, 50);
    const restoredHash = restored.rows.find((row) => row.recordPk === sessionId)?.contentHash;
    expect(restoredHash).toBe(orderedHash);
  });
});
