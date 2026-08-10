import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbOrTx } from "@/db/client";
import * as schema from "@/db/schema";
import { getOrCreateEmbedConfigIn, isEmbedEnabledIn, listEmbedConfigsIn } from "@/features/public/server/embed-config-queries";
import { updateEmbedConfigIn } from "@/features/public/server/embed-config-mutations";
import type { EmbedId, EventId } from "@/shared/contracts";

const migration0 = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");

const eventId = "b1000000-0000-4000-8000-000000000001" as EventId;
const otherEventId = "b1000000-0000-4000-8000-000000000002" as EventId;

let pglite: PGlite;
let db: DbOrTx;

describe("embed config CRUD (M33)", () => {
  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migration0);
    await pglite.exec(migration1);
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

  it("creates a default row on first read and returns the same row on subsequent reads", async () => {
    const first = await getOrCreateEmbedConfigIn(db, eventId, "schedule_itinerary");
    expect(first.enabled).toBe(true);
    expect(first.contentType).toBe("schedule_itinerary");
    expect(first.eventId).toBe(eventId);
    expect(first.style).toEqual({});

    const second = await getOrCreateEmbedConfigIn(db, eventId, "schedule_itinerary");
    expect(second.id).toBe(first.id);

    const rows = await pglite.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM embeds WHERE event_id = $1 AND content_type = 'schedule_itinerary'",
      [eventId],
    );
    expect(rows.rows[0]?.count).toBe("1");
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

  it("refuses to update a config row that belongs to a different event (IDOR-proof)", async () => {
    const config = await getOrCreateEmbedConfigIn(db, eventId, "schedule_itinerary");
    await expect(updateEmbedConfigIn(db, otherEventId, config.id, { enabled: false })).rejects.toMatchObject({ code: "NOT_FOUND" });
    // The row must be untouched by the rejected cross-event write.
    await expect(isEmbedEnabledIn(db, eventId, "schedule_itinerary")).resolves.toBe(true);
  });

  it("updateEmbedConfigIn on an id that doesn't exist raises NOT_FOUND rather than silently no-op-ing", async () => {
    await expect(updateEmbedConfigIn(db, eventId, "b1000000-0000-4000-8000-0000000000ff" as EmbedId, { enabled: false })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("listEmbedConfigsIn returns both canonical types, event-scoped, creating any missing ones", async () => {
    const configs = await listEmbedConfigsIn(db, otherEventId);
    expect(configs).toHaveLength(2);
    expect(configs.map((config) => config.contentType).sort()).toEqual(["schedule_itinerary", "speaker_gallery"]);
    for (const config of configs) expect(config.eventId).toBe(otherEventId);
  });
});
