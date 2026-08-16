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
// The unique on (event_id, content_type) this module's creators now target
// with ON CONFLICT — without it every `getOrCreate…` here raises "no unique or
// exclusion constraint matching the ON CONFLICT specification".
const migrationEmbedUnique = readFileSync(new URL("../../drizzle/0049_embeds_one_row_per_content_type.sql", import.meta.url), "utf8");
const migrationSessionPlacementRevisions = readFileSync(new URL("../../drizzle/0050_session_placement_revisions.sql", import.meta.url), "utf8");

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
    await pglite.exec(migrationEmbedUnique);
    await pglite.exec(migrationSessionPlacementRevisions);
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

  it("refuses a second embed row for a content type the event already has", async () => {
    // The losing half of the race, made unrepresentable. Two admins opening the
    // embeds page at once for a never-configured event both inserted; the one
    // holding its own row then PATCHed the duplicate forever, because every
    // reader — `findRow`, and through it `isEmbedEnabledIn`, the public route's
    // kill switch — resolved the other one. Every toggle looked saved and
    // changed nothing anybody would serve.
    const raceEventId = eventIdSchema.parse("b7000000-0000-4000-8000-0000000000d1");
    await pglite.query(
      "INSERT INTO events(id,name,slug,timezone,starts_at,ends_at) VALUES($1,'Dup Embed','dup-embed','UTC','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
      [raceEventId],
    );
    await pglite.query(
      "INSERT INTO embeds(event_id,content_type,name,enabled,style,filters) VALUES($1,'schedule_itinerary','First',false,'{}'::jsonb,'{}'::jsonb)",
      [raceEventId],
    );

    await expect(pglite.query(
      "INSERT INTO embeds(event_id,content_type,name,enabled,style,filters) VALUES($1,'schedule_itinerary','Second',true,'{}'::jsonb,'{}'::jsonb)",
      [raceEventId],
    )).rejects.toThrow(/embeds_event_id_content_type_unique|duplicate key/u);

    // And the creator hands back the row that survived, kill switch and all —
    // never a fresh default whose edits nobody would ever serve.
    const config = await getOrCreateEmbedConfigIn(db, raceEventId, "schedule_itinerary");
    expect(config.enabled).toBe(false);

    await pglite.query("DELETE FROM events WHERE id=$1", [raceEventId]);
  });

  it("answers the insert path from the row a reader resolves, not from its own insert", async () => {
    // The path the race actually bites on: no row yet, so this runs the INSERT
    // and then has to decide what to hand back. Reproducing two connections is
    // beyond the harness, so the behavioural half pins the contract — whatever
    // comes back is the row `findRow` resolves — and the source half pins the
    // shape that keeps it true under concurrency.
    const freshEventId = eventIdSchema.parse("b7000000-0000-4000-8000-0000000000d2");
    await pglite.query(
      "INSERT INTO events(id,name,slug,timezone,starts_at,ends_at) VALUES($1,'Fresh Embed','fresh-embed','UTC','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
      [freshEventId],
    );

    const created = await getOrCreateEmbedConfigIn(db, freshEventId, "session_list");
    const resolved = await pglite.query<{ id: string }>(
      "SELECT id FROM embeds WHERE event_id=$1 AND content_type='session_list' ORDER BY created_at LIMIT 1",
      [freshEventId],
    );
    expect(created.id).toBe(resolved.rows[0]?.id);

    const source = readFileSync(new URL("../../src/features/public/server/embed-config-queries.ts", import.meta.url), "utf8");
    const creators = source.split("export async function getOrCreate").slice(1);
    expect(creators).toHaveLength(2);
    for (const creator of creators) {
      const body = creator.slice(0, creator.indexOf("\n}"));
      // `.returning()` is the bug: it answers with the row this connection
      // wrote, which is the row nobody reads when it lost the race.
      expect(body).not.toContain(".returning()");
      // The losing INSERT has to be a no-op rather than an error…
      expect(body).toContain("onConflictDoNothing");
      // …and the answer has to come from a lookup made *after* it. Both
      // creators already open with a `findRow`, so the position is the
      // assertion — without it, deleting the second lookup would still pass.
      const insertAt = body.indexOf(".insert(embeds)");
      expect(insertAt).toBeGreaterThan(-1);
      expect(body.indexOf("await findRow(", insertAt)).toBeGreaterThan(insertAt);
    }

    await pglite.query("DELETE FROM events WHERE id=$1", [freshEventId]);
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
