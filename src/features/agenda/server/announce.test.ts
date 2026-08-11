import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eventIdSchema } from "@/shared/contracts";
import { getAnnounceBundleIn } from "./announce";

const migration0 = readFileSync(new URL("../../../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");

const EVENT = eventIdSchema.parse("e0000000-0000-4000-8000-000000000001");
const MISSING_EVENT = eventIdSchema.parse("e0000000-0000-4000-8000-000000000099");
const BASE_URL = "https://example.openboard.events";

let pg: PGlite;

describe("announce bundle", () => {
  beforeAll(async () => {
    pg = new PGlite();
    await pg.exec(migration0);
    await pg.exec(migration1);

    await pg.query(
      `INSERT INTO events(id,name,slug,timezone,starts_at,ends_at) VALUES ($1,'Announce Conf','announce-conf','America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')`,
      [EVENT],
    );
    await pg.query(
      `INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES ('e0000000-0000-4000-8000-000000000010',$1,'ada@example.com','Ada','Lovelace')`,
      [EVENT],
    );
    await pg.query(
      `INSERT INTO submissions(id,event_id,code,status,source,title) VALUES ('e0000000-0000-4000-8000-000000000020',$1,1,'accepted','cfp','A talk')`,
      [EVENT],
    );
    await pg.query(
      `INSERT INTO submission_participants(event_id,submission_id,contact_id,is_primary,sort_order) VALUES ($1,'e0000000-0000-4000-8000-000000000020','e0000000-0000-4000-8000-000000000010',true,0)`,
      [EVENT],
    );
  });

  afterAll(async () => {
    await pg.close();
  });

  it("returns null for an event that does not exist", async () => {
    const db = drizzle(pg);
    expect(await getAnnounceBundleIn(db, MISSING_EVENT, BASE_URL)).toBeNull();
  });

  it("reports no published schedule and no speaker links before anything is published", async () => {
    const db = drizzle(pg);
    const bundle = await getAnnounceBundleIn(db, EVENT, BASE_URL);
    expect(bundle?.hasPublishedSchedule).toBe(false);
    expect(bundle?.speakerLinks).toEqual([]);
    // URLs, the embed snippet and the announcement copy are still real —
    // an organizer can copy them ahead of publish, they just point at a
    // page that will 404 or show "coming soon" until sessions go public.
    expect(bundle?.publicUrls.agenda).toBe(`${BASE_URL}/e/announce-conf/agenda`);
    expect(bundle?.embedSnippet).toContain(`${BASE_URL}/embed/announce-conf/agenda`);
    expect(bundle?.announcementCopy).toContain("Announce Conf");
  });

  it("lists every accepted speaker once the schedule is published, degrading share links gracefully without a signing secret", async () => {
    await pg.query(
      `INSERT INTO sessions(id,event_id,submission_id,title,slug,status,starts_at,ends_at) VALUES ('e0000000-0000-4000-8000-000000000030',$1,'e0000000-0000-4000-8000-000000000020','A talk','a-talk','published','2026-09-16T17:00:00Z','2026-09-16T17:30:00Z')`,
      [EVENT],
    );
    const db = drizzle(pg);
    const bundle = await getAnnounceBundleIn(db, EVENT, BASE_URL);
    expect(bundle?.hasPublishedSchedule).toBe(true);
    expect(bundle?.speakerLinks).toEqual([{ contactId: "e0000000-0000-4000-8000-000000000010", name: "Ada Lovelace", shareUrl: null }]);
  });
});
