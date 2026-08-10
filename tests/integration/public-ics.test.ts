import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbOrTx } from "@/db/client";
import * as schema from "@/db/schema";
import { buildPublicScheduleIcsIn } from "@/features/public/server/public-ics";
import { parseEnv } from "@/shared/lib/env";

function required<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) throw new Error(message);
  return value;
}

const migration0 = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");
const migrationReviewOps = readFileSync(new URL("../../drizzle/0004_review_operations.sql", import.meta.url), "utf8");

const env = parseEnv({
  APP_ENV: "local",
  APP_BASE_URL: "https://events.example.com",
  EMAIL_MODE: "log",
  EMAIL_FROM: "Openboard <hello@events.example.com>",
});

const eventId = "c1000000-0000-4000-8000-000000000001";
const eventSlug = "test-event";
const speakerId = "c1000000-0000-4000-8000-000000000020";
const sessionKeep = "c1000000-0000-4000-8000-000000000030";
const sessionRemove = "c1000000-0000-4000-8000-000000000031";
const sessionDraft = "c1000000-0000-4000-8000-000000000032";

let pglite: PGlite;
let db: DbOrTx;

describe("buildPublicScheduleIcsIn (M53 anonymous itinerary export, reuses M35's builder)", () => {
  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migration0);
    await pglite.exec(migration1);
    await pglite.exec(migrationReviewOps);
    db = drizzle(pglite, { schema }) as unknown as DbOrTx;

    await pglite.query(
      "INSERT INTO events(id,name,slug,timezone,starts_at,ends_at) VALUES($1,'Test Event','test-event','America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
      [eventId],
    );
    await pglite.query(
      "INSERT INTO contacts(id,event_id,email,first_name,last_name,confirmation_status) VALUES($1,$2,'ada@example.com','Ada','Lovelace','confirmed')",
      [speakerId, eventId],
    );
    await pglite.query(
      "INSERT INTO sessions(id,event_id,title,slug,description_html,starts_at,ends_at,status) VALUES($1,$2,'Keep Me','keep-me','<p>Keep description</p>','2026-09-16T05:30:00Z','2026-09-16T06:00:00Z','published')",
      [sessionKeep, eventId],
    );
    await pglite.query(
      "INSERT INTO sessions(id,event_id,title,slug,starts_at,ends_at,status) VALUES($1,$2,'Also Published','also-published','2026-09-16T07:00:00Z','2026-09-16T07:30:00Z','published')",
      [sessionRemove, eventId],
    );
    await pglite.query(
      "INSERT INTO sessions(id,event_id,title,slug,starts_at,ends_at,status) VALUES($1,$2,'Still A Draft','still-a-draft','2026-09-16T08:00:00Z','2026-09-16T08:30:00Z','draft')",
      [sessionDraft, eventId],
    );
    await pglite.query("INSERT INTO session_speakers(event_id,session_id,contact_id,sort_order) VALUES($1,$2,$3,0)", [eventId, sessionKeep, speakerId]);
  });

  afterAll(async () => {
    await pglite.close();
  });

  it("returns null for an unknown slug instead of throwing", async () => {
    expect(await buildPublicScheduleIcsIn(db, "no-such-event", null, env)).toBeNull();
  });

  it("with sessionIds=null, includes every published session and excludes drafts", async () => {
    const { ics } = required(await buildPublicScheduleIcsIn(db, eventSlug, null, env), "expected a calendar");
    expect(ics).toContain("SUMMARY:Keep Me");
    expect(ics).toContain("SUMMARY:Also Published");
    expect(ics).not.toContain("Still A Draft");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
  });

  it("star two, remove one: the exported calendar contains only the remaining session", async () => {
    // Simulates the itinerary's localStorage reconciliation already having
    // dropped `sessionRemove` (removed from My Schedule) — the caller passes
    // only the ids that are still starred, exactly what the itinerary UI does.
    const { ics } = required(await buildPublicScheduleIcsIn(db, eventSlug, [sessionKeep], env), "expected a calendar");
    expect(ics).toContain("SUMMARY:Keep Me");
    expect(ics).not.toContain("SUMMARY:Also Published");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  });

  it("silently drops an id that is no longer published (unpublished/deleted-id reconciliation)", async () => {
    const { ics } = required(await buildPublicScheduleIcsIn(db, eventSlug, [sessionKeep, sessionDraft, "not-a-real-id"], env), "expected a calendar");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).toContain("SUMMARY:Keep Me");
  });

  it("an empty selection produces a valid, empty calendar rather than falling back to the full schedule", async () => {
    const { ics } = required(await buildPublicScheduleIcsIn(db, eventSlug, [], env), "expected a calendar");
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("END:VCALENDAR");
    expect(ics).not.toContain("BEGIN:VEVENT");
  });

  it("every event is a plain feed entry, never a REQUEST/CANCEL invite (no attendee required)", async () => {
    const { ics } = required(await buildPublicScheduleIcsIn(db, eventSlug, [sessionKeep], env), "expected a calendar");
    expect(ics).not.toContain("METHOD:REQUEST");
    expect(ics).not.toContain("METHOD:CANCEL");
    expect(ics).not.toContain("ATTENDEE");
    expect(ics).toContain("STATUS:CONFIRMED");
  });

  it("carries a stable UID for the same session across repeated exports", async () => {
    const first = required(await buildPublicScheduleIcsIn(db, eventSlug, [sessionKeep], env), "expected a calendar");
    const second = required(await buildPublicScheduleIcsIn(db, eventSlug, [sessionKeep], env), "expected a calendar");
    const uidOf = (ics: string) => /UID:([^\r\n]+)/.exec(ics)?.[1];
    expect(uidOf(first.ics)).toBe(uidOf(second.ics));
  });
});
