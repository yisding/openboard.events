import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import { sanitize } from "@/shared/lib/sanitize";
import { SEEDED_EMPTY_EVENT_ID, SEEDED_EVENT_ID } from "../../scripts/seed/lib/helpers";
import { seedId } from "../../scripts/seed/lib/ids";
import { seedPortal } from "../../scripts/seed/portal";
import { seedResources } from "../../scripts/seed/resources";

/**
 * The resource seed runs *after* `portal.ts` in the orchestrator, and the two
 * modules used to seed five near-duplicate pages between them. This exercises
 * the real composition — portal first, then resources — so the CP3 demo's
 * page count is a tested property rather than an eyeballed one.
 */

const migration0 = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");
// M50 is additive on top of the base schema; applying it keeps this fixture
// aligned with the columns the repository modules now read.
const migrationReviewOps = readFileSync(new URL("../../drizzle/0004_review_operations.sql", import.meta.url), "utf8");
const migrationParticipantReceipts = readFileSync(new URL("../../drizzle/0032_participant_step_receipts.sql", import.meta.url), "utf8");

describe("resources seed", () => {
  let pglite: PGlite;
  let ctx: { tx: TxDb; now: Date; eventId: typeof SEEDED_EVENT_ID; emptyEventId: typeof SEEDED_EMPTY_EVENT_ID; id: typeof seedId; log: (message: string) => void };
  const logs: string[] = [];

  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migration0);
    await pglite.exec(migration1);
    await pglite.exec(migrationReviewOps);
    await pglite.exec(migrationParticipantReceipts);
    await pglite.query(
      "INSERT INTO events(id,name,slug,starts_at,ends_at) VALUES($1,'Seed Event','seed-event','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
      [SEEDED_EVENT_ID],
    );
    ctx = {
      tx: drizzle(pglite, { schema }) as unknown as TxDb,
      now: new Date("2026-08-09T12:00:00.000Z"),
      eventId: SEEDED_EVENT_ID,
      emptyEventId: SEEDED_EMPTY_EVENT_ID,
      id: seedId,
      log: (message: string) => logs.push(message),
    };
    await seedPortal(ctx);
    await seedResources(ctx);
  }, 60_000);

  afterAll(async () => {
    await pglite.close();
  });

  async function slugs(): Promise<string[]> {
    const rows = await pglite.query<{ slug: string }>(
      "SELECT slug FROM resource_pages WHERE event_id = $1 ORDER BY sort_order",
      [SEEDED_EVENT_ID],
    );
    return rows.rows.map((row) => row.slug);
  }

  it("leaves exactly the three pages the work order names, with portal.ts's duplicates retired", async () => {
    expect(await slugs()).toEqual(["speaker-guide", "venue-travel", "internal-notes"]);
  });

  it("keeps the unpublished page unpublished, so the portal 404 case has a row", async () => {
    const rows = await pglite.query<{ slug: string; published: boolean }>(
      "SELECT slug, published FROM resource_pages WHERE event_id = $1 AND NOT published",
      [SEEDED_EVENT_ID],
    );
    expect(rows.rows.map((row) => row.slug)).toEqual(["internal-notes"]);
  });

  it("carries both sanitizer probes on one published page", async () => {
    const rows = await pglite.query<{ body_html: string }>(
      "SELECT body_html FROM resource_pages WHERE event_id = $1 AND slug = 'venue-travel'",
      [SEEDED_EVENT_ID],
    );
    const body = rows.rows[0]?.body_html ?? "";
    // Stored raw — this seed deliberately bypasses the save-time sanitizer so
    // the render-side one is what gets proven.
    expect(body).toContain("<script>");
    expect(body).toContain("onerror");
    expect(sanitize(body, { profile: "wide" })).toContain("youtube.com/embed");
    expect(sanitize(body, { profile: "wide" })).not.toContain("<script");
    expect(sanitize(body, { profile: "wide" })).not.toContain("onerror");
  });

  it("re-runs as a no-op — no duplicates, and the retirement stays retired", async () => {
    await seedResources(ctx);
    expect(await slugs()).toEqual(["speaker-guide", "venue-travel", "internal-notes"]);
    // The second run finds nothing left to retire and says so.
    expect(logs[logs.length - 1]).not.toContain("retired");
  });
});
