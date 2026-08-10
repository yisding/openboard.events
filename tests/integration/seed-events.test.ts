import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import { seedEvents } from "../../scripts/seed/events";
import { eventLocal, SEEDED_EMPTY_EVENT_ID, SEEDED_EVENT_ID, type SeedCtx } from "../../scripts/seed/lib/helpers";
import { seedId } from "../../scripts/seed/lib/ids";

const migration0 = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
// P3-EMAIL added `events.physical_address`; the seed writes events through
// Drizzle, which names every mapped column, so the fixture needs the column
// to exist even though this suite never asserts on it.
const migrationEmailCompliance = readFileSync(new URL("../../drizzle/0007_email_compliance.sql", import.meta.url), "utf8");
// M42 added `users.email_verified`/`users.image`, which the seed's admin
// upsert names on every insert — same reason as the line above.
const migrationProductAuth = readFileSync(new URL("../../drizzle/0009_product_auth.sql", import.meta.url), "utf8");
// M43 added `events.organization_id` — same reason as the line above.
const migrationTenancy = readFileSync(new URL("../../drizzle/0010_organization_tenancy.sql", import.meta.url), "utf8");

describe("events seed", () => {
  let pglite: PGlite;
  let ctx: SeedCtx;

  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migration0);
    await pglite.exec(migrationEmailCompliance);
    await pglite.exec(migrationProductAuth);
    await pglite.exec(migrationTenancy);
    ctx = {
      tx: drizzle(pglite, { schema }) as unknown as TxDb,
      now: new Date("2026-08-09T12:00:00.000Z"),
      eventId: SEEDED_EVENT_ID,
      emptyEventId: SEEDED_EMPTY_EVENT_ID,
      id: seedId,
      log: () => undefined,
    };
    await seedEvents(ctx);
  }, 60_000);

  afterAll(async () => {
    await pglite.close();
  });

  it("refreshes the empty event's relative dates on rerun", async () => {
    ctx.now = new Date("2026-09-09T12:00:00.000Z");

    await seedEvents(ctx);

    const result = await pglite.query<{ starts_at: Date; ends_at: Date }>(
      "SELECT starts_at,ends_at FROM events WHERE id=$1",
      [SEEDED_EMPTY_EVENT_ID],
    );
    expect(result.rows[0]).toEqual({
      starts_at: eventLocal(ctx.now, 120, "09:00"),
      ends_at: eventLocal(ctx.now, 121, "17:00"),
    });
  });
});
