import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbOrTx } from "@/db/client";
import * as schema from "@/db/schema";
import { getPortalShellDataIn } from "@/features/portal/server/shell";
import { contactIdSchema, eventIdSchema } from "@/shared/contracts";

const migration0 = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");

const eventId = eventIdSchema.parse("c1000000-0000-4000-8000-000000000001");
const otherEventId = eventIdSchema.parse("c1000000-0000-4000-8000-000000000002");
const speaker = contactIdSchema.parse("c1000000-0000-4000-8000-000000000010");
const otherEventSpeaker = contactIdSchema.parse("c1000000-0000-4000-8000-000000000011");

/**
 * The portal chrome used to resolve its event out of the browser demo fixture,
 * which never contains a real event, so every signed-in speaker got the 404
 * page. These are the reads that replace that lookup.
 */
describe("portal shell data (M06b portal chrome)", () => {
  let pglite: PGlite;
  let database: DbOrTx;

  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migration0);
    await pglite.exec(migration1);
    database = drizzle(pglite, { schema }) as unknown as DbOrTx;
    await pglite.query(
      "INSERT INTO events(id,name,slug,timezone,location,starts_at,ends_at) VALUES($1,'AI.Engineer Sandbox — NYC','ai-engineer-sandbox-event','America/New_York','New York, NY','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
      [eventId],
    );
    await pglite.query(
      "INSERT INTO events(id,name,slug,timezone,starts_at,ends_at) VALUES($1,'Other','other-event','UTC','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
      [otherEventId],
    );
    await pglite.query(
      "INSERT INTO contacts(id,event_id,email,first_name,last_name,company,job_title,confirmation_status) VALUES($1,$2,'alan@openboard.events','Alan','Turing','Bletchley','Cryptanalyst','confirmed')",
      [speaker, eventId],
    );
    await pglite.query(
      "INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES($1,$2,'grace@openboard.events','Grace','Hopper')",
      [otherEventSpeaker, otherEventId],
    );
  }, 60_000);

  afterAll(async () => {
    await pglite.close();
  });

  it("returns the signed-in speaker's own event and contact", async () => {
    const shell = await getPortalShellDataIn(database, eventId, speaker);
    expect(shell?.event).toMatchObject({
      id: eventId,
      slug: "ai-engineer-sandbox-event",
      name: "AI.Engineer Sandbox — NYC",
      timezone: "America/New_York",
      city: "New York, NY",
    });
    expect(shell?.speaker).toMatchObject({
      id: speaker,
      eventId,
      firstName: "Alan",
      lastName: "Turing",
      email: "alan@openboard.events",
      company: "Bletchley",
      title: "Cryptanalyst",
      avatar: "AT",
      confirmation: "confirmed",
      hasHeadshot: false,
    });
    expect(shell?.openTaskCount).toBe(0);
  });

  // R4: (id, eventId) are scoped together, so a session for one event can never
  // resolve a contact belonging to another even if the id were guessed.
  it("does not resolve a contact from another event", async () => {
    expect(await getPortalShellDataIn(database, eventId, otherEventSpeaker)).toBeNull();
  });

  it("returns null for an event that no longer exists", async () => {
    const missing = eventIdSchema.parse("c1000000-0000-4000-8000-0000000000ff");
    expect(await getPortalShellDataIn(database, missing, speaker)).toBeNull();
  });

  it("gives a speaker the same avatar colour on every render", async () => {
    const first = await getPortalShellDataIn(database, eventId, speaker);
    const second = await getPortalShellDataIn(database, eventId, speaker);
    expect(first?.speaker.avatarColor).toBe(second?.speaker.avatarColor);
    expect(first?.speaker.avatarColor).toMatch(/^var\(--avatar-hue-(?:[1-9]|10)\)$/);
  });
});
