import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbOrTx } from "@/db/client";
import * as schema from "@/db/schema";
import {
  getOrCreateEmbedConfigIn,
  getOrCreateSpeakerListConfigIn,
  getPublicEmbedConfigIn,
  isEmbedEnabledIn,
  listEmbedConfigsIn,
} from "@/features/public/server/embed-config-queries";
import { updateEmbedConfigIn } from "@/features/public/server/embed-config-mutations";
import { eventIdSchema, type EmbedId, type EventId } from "@/shared/contracts";

const migration0 = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");
// M50 is additive on top of the base schema; applying it keeps this fixture
// aligned with the columns the repository modules now read.
const migrationReviewOps = readFileSync(new URL("../../drizzle/0004_review_operations.sql", import.meta.url), "utf8");

const eventId = "b1000000-0000-4000-8000-000000000001" as EventId;
const otherEventId = "b1000000-0000-4000-8000-000000000002" as EventId;

let pglite: PGlite;
let db: DbOrTx;

describe("embed config CRUD (M33/M53)", () => {
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
      "INSERT INTO events(id,name,slug,timezone,starts_at,ends_at) VALUES($1,'Other Event','other-event','America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
      [otherEventId],
    );
  });

  afterAll(async () => {
    await pglite.close();
  });

  it("treats a never-configured event as enabled — the public route must work before any admin visits settings", async () => {
    await expect(isEmbedEnabledIn(db, eventId, "schedule_itinerary")).resolves.toBe(true);
    await expect(isEmbedEnabledIn(db, eventId, "speaker_gallery")).resolves.toBe(true);
  });

  it("keeps public rendering read-only while preserving legacy speaker-list settings", async () => {
    const publicEventId = "b1000000-0000-4000-8000-000000000005" as EventId;
    await pglite.query(
      "INSERT INTO events(id,name,slug,timezone,starts_at,ends_at) VALUES($1,'Public Event','public-event','America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
      [publicEventId],
    );

    await expect(getPublicEmbedConfigIn(db, publicEventId, "agenda")).resolves.toEqual({
      enabled: true,
      style: {},
      filters: {},
    });
    const empty = await pglite.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM embeds WHERE event_id = $1",
      [publicEventId],
    );
    expect(empty.rows[0]?.count).toBe("0");

    const legacy = await getOrCreateEmbedConfigIn(db, publicEventId, "speaker_gallery");
    await updateEmbedConfigIn(db, publicEventId, legacy.id, {
      enabled: false,
      style: { theme: "dark" },
      filters: { trackIds: ["legacy-track"] },
    });
    await expect(getPublicEmbedConfigIn(db, publicEventId, "speaker_list")).resolves.toEqual({
      enabled: false,
      style: { theme: "dark" },
      filters: { trackIds: ["legacy-track"] },
    });
    const inherited = await pglite.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM embeds WHERE event_id = $1 AND content_type = 'speaker_list'",
      [publicEventId],
    );
    expect(inherited.rows[0]?.count).toBe("0");
  });

  it("creates a default row on first read and returns the same row on subsequent reads", async () => {
    const first = await getOrCreateEmbedConfigIn(db, eventId, "schedule_itinerary");
    expect(first.enabled).toBe(true);
    expect(first.contentType).toBe("schedule_itinerary");
    expect(first.eventId).toBe(eventId);
    expect(first.style).toEqual({});
    expect(first.filters).toEqual({});

    const second = await getOrCreateEmbedConfigIn(db, eventId, "schedule_itinerary");
    expect(second.id).toBe(first.id);

    const rows = await pglite.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM embeds WHERE event_id = $1 AND content_type = 'schedule_itinerary'",
      [eventId],
    );
    expect(rows.rows[0]?.count).toBe("1");
  });

  it("always hands back the row every reader will see", async () => {
    // There is no unique index on (event_id, content_type), and `findRow`
    // deliberately takes the *earliest* row. `getOrCreate…` used to return the
    // row it had just inserted, so two admins opening the embeds page at once
    // for a never-configured event both inserted, and the one holding its own
    // row then PATCHed the duplicate forever — every toggle, the kill switch
    // included, looked saved while the public route kept serving the other row.
    //
    // The race itself needs two live connections, which the harness cannot
    // provide — so this pins the contract the fix restores: whatever
    // `getOrCreate…` answers is the row `findRow` resolves, which is the row
    // every public reader and every later PATCH will use. The source assertion
    // below covers the insert path, where the race actually bites.
    const duplicateEventId = eventIdSchema.parse("b7000000-0000-4000-8000-0000000000d1");
    await pglite.query(
      "INSERT INTO events(id,name,slug,timezone,starts_at,ends_at) VALUES($1,'Dup Embed','dup-embed','UTC','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
      [duplicateEventId],
    );
    await pglite.query(
      "INSERT INTO embeds(event_id,content_type,name,enabled,style,filters,created_at) VALUES($1,'schedule_itinerary','Earliest',false,'{}'::jsonb,'{}'::jsonb, now() - interval '1 hour')",
      [duplicateEventId],
    );

    const config = await getOrCreateEmbedConfigIn(db, duplicateEventId, "schedule_itinerary");
    // The earliest row — the one `isEmbedEnabledIn` and every public reader
    // resolve — not a fresh one whose edits nobody would ever serve. `enabled`
    // is the kill switch, and a freshly inserted row would have defaulted to
    // true.
    expect(config.enabled).toBe(false);
    const stored = await pglite.query<{ id: string }>(
      "SELECT id FROM embeds WHERE event_id=$1 AND content_type='schedule_itinerary' ORDER BY created_at LIMIT 1",
      [duplicateEventId],
    );
    expect(config.id).toBe(stored.rows[0]?.id);

    await pglite.query("DELETE FROM events WHERE id=$1", [duplicateEventId]);
  });

  it("resolves the row after inserting rather than trusting its own insert", async () => {
    // There is no unique index on (event_id, content_type). Two admins opening
    // the embeds page at once for a never-configured event both insert; the one
    // that returned its own `.returning()` row then PATCHed the duplicate
    // forever, so every toggle — the kill switch included — looked saved while
    // the public route kept serving the other row. Asserted on the source
    // because reproducing it needs two connections.
    const source = readFileSync(new URL("../../src/features/public/server/embed-config-queries.ts", import.meta.url), "utf8");
    const creators = source.split("export async function getOrCreate").slice(1);
    expect(creators).toHaveLength(2);
    for (const creator of creators) {
      const body = creator.slice(0, creator.indexOf("\n}"));
      expect(body).not.toContain(".returning()");
      expect(body).toContain("await findRow(");
    }
  });

  it("round-trips enabled + style through updateEmbedConfigIn, scoped by event id", async () => {
    const config = await getOrCreateEmbedConfigIn(db, eventId, "speaker_gallery");

    const disabled = await updateEmbedConfigIn(db, eventId, config.id, { enabled: false });
    expect(disabled.enabled).toBe(false);
    await expect(isEmbedEnabledIn(db, eventId, "speaker_gallery")).resolves.toBe(false);

    const styled = await updateEmbedConfigIn(db, eventId, config.id, { style: { accent: "#ff0000", theme: "dark", showHeader: false } });
    expect(styled.style).toEqual({ accent: "#ff0000", theme: "dark", showHeader: false });
    // The enabled flag from the prior write must survive an unrelated style-only patch.
    expect(styled.enabled).toBe(false);

    const reenabled = await updateEmbedConfigIn(db, eventId, config.id, { enabled: true });
    expect(reenabled.enabled).toBe(true);
    expect(reenabled.style).toEqual({ accent: "#ff0000", theme: "dark", showHeader: false });
  });

  it("round-trips content filters and field visibility through updateEmbedConfigIn, replacing the whole object", async () => {
    const config = await getOrCreateEmbedConfigIn(db, eventId, "session_list");

    const withFilters = await updateEmbedConfigIn(db, eventId, config.id, {
      filters: { trackIds: ["t1", "t2"], formatIds: ["f1"], fields: { description: false } },
    });
    expect(withFilters.filters).toEqual({ trackIds: ["t1", "t2"], formatIds: ["f1"], fields: { description: false } });

    // A later filters-only patch replaces the whole object, same discipline as `style`.
    const replaced = await updateEmbedConfigIn(db, eventId, config.id, { filters: { roomIds: ["r1"] } });
    expect(replaced.filters).toEqual({ roomIds: ["r1"] });
  });

  it("refuses to update a config row that belongs to a different event (IDOR-proof)", async () => {
    const config = await getOrCreateEmbedConfigIn(db, eventId, "schedule_itinerary");
    await expect(updateEmbedConfigIn(db, otherEventId, config.id, { enabled: false })).rejects.toMatchObject({ code: "NOT_FOUND" });
    // The row must be untouched by the rejected cross-event write.
    await expect(isEmbedEnabledIn(db, eventId, "schedule_itinerary")).resolves.toBe(true);
  });

  it("updateEmbedConfigIn on an id that doesn't exist raises NOT_FOUND rather than silently no-op-ing", async () => {
    await expect(updateEmbedConfigIn(db, eventId, "b1000000-0000-4000-8000-0000000000ff" as EmbedId, { enabled: false })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("the admin list seeds a first-ever speaker_list row from the legacy speaker_gallery config", async () => {
    const migratedEventId = "b1000000-0000-4000-8000-000000000003" as EventId;
    await pglite.query(
      "INSERT INTO events(id,name,slug,timezone,starts_at,ends_at) VALUES($1,'Migrated Event','migrated-event','America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
      [migratedEventId],
    );

    // Simulate a pre-M53 admin who disabled and restyled the legacy gallery embed.
    const legacy = await getOrCreateEmbedConfigIn(db, migratedEventId, "speaker_gallery");
    await updateEmbedConfigIn(db, migratedEventId, legacy.id, { enabled: false, style: { accent: "#ff00aa", theme: "dark" } });

    const migrated = (await listEmbedConfigsIn(db, migratedEventId))
      .find((config) => config.contentType === "speaker_list");
    if (!migrated) throw new Error("speaker_list config missing");
    expect(migrated.contentType).toBe("speaker_list");
    expect(migrated.enabled).toBe(false);
    expect(migrated.style).toEqual({ accent: "#ff00aa", theme: "dark" });

    // Idempotent: a second read returns the same row, not a re-seeded one.
    await updateEmbedConfigIn(db, migratedEventId, migrated.id, { enabled: true });
    const second = await getOrCreateSpeakerListConfigIn(db, migratedEventId);
    expect(second.id).toBe(migrated.id);
    expect(second.enabled).toBe(true);
  });

  it("getOrCreateSpeakerListConfigIn defaults normally when no legacy speaker_gallery row exists", async () => {
    const freshEventId = "b1000000-0000-4000-8000-000000000004" as EventId;
    await pglite.query(
      "INSERT INTO events(id,name,slug,timezone,starts_at,ends_at) VALUES($1,'Fresh Event','fresh-event','America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
      [freshEventId],
    );
    const config = await getOrCreateSpeakerListConfigIn(db, freshEventId);
    expect(config.enabled).toBe(true);
    expect(config.style).toEqual({});
  });

  it("listEmbedConfigsIn returns all five canonical types, event-scoped, creating any missing ones", async () => {
    const configs = await listEmbedConfigsIn(db, otherEventId);
    expect(configs).toHaveLength(5);
    expect(configs.map((config) => config.contentType).sort()).toEqual([
      "agenda", "schedule_itinerary", "session_list", "speaker_gallery", "speaker_list",
    ]);
    for (const config of configs) expect(config.eventId).toBe(otherEventId);
  });
});
