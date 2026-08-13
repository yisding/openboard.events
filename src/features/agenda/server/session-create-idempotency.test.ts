import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbOrTx } from "@/db/client";
import * as schema from "@/db/schema";
import { contactIdSchema, eventIdSchema, sessionIdSchema } from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";
import { createSessionInputSchema, saveSessionIn } from "./mutations";

const migration0 = readFileSync(new URL("../../../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migrationContentRevisions = readFileSync(new URL("../../../../drizzle/0006_content_deliverables.sql", import.meta.url), "utf8");

const eventId = eventIdSchema.parse("a4100000-0000-4000-8000-000000000001");
const otherEventId = eventIdSchema.parse("a4100000-0000-4000-8000-000000000002");
const creationId = sessionIdSchema.parse("a4200000-0000-4000-8000-000000000001");
const distinctCreationId = sessionIdSchema.parse("a4200000-0000-4000-8000-000000000002");
const firstSpeaker = contactIdSchema.parse("a4300000-0000-4000-8000-000000000001");
const secondSpeaker = contactIdSchema.parse("a4300000-0000-4000-8000-000000000002");

describe("retry-safe manual session creation", () => {
  let pg: PGlite;
  let database: DbOrTx;

  beforeAll(async () => {
    pg = new PGlite();
    await pg.exec(migration0);
    await pg.exec(migrationContentRevisions);
    database = drizzle(pg, { schema }) as unknown as DbOrTx;
    await pg.query(
      `INSERT INTO events(id,name,slug,timezone,starts_at,ends_at) VALUES
       ($1,'Retry Conf','retry-conf','America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z'),
       ($2,'Other Conf','other-conf','America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')`,
      [eventId, otherEventId],
    );
    await pg.query(
      `INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES
       ($1,$3,'ada@example.com','Ada','Lovelace'),
       ($2,$3,'grace@example.com','Grace','Hopper')`,
      [firstSpeaker, secondSpeaker, eventId],
    );
  }, 60_000);

  afterAll(async () => pg.close());

  const input = {
    creationId,
    title: "A Retry-Safe Session",
    descriptionHtml: "<p>Canonical details</p>",
    formatId: null,
    trackId: null,
    roomId: null,
    startsAt: "2026-09-16T17:00:00.000Z",
    endsAt: "2026-09-16T17:30:00.000Z",
    speakerContactIds: [firstSpeaker, secondSpeaker],
    status: "published" as const,
  };

  it("returns one canonical graph and one outbox row per speaker when the same attempt is replayed", async () => {
    expect(createSessionInputSchema.safeParse({ ...input, creationId: undefined }).success).toBe(false);
    expect(createSessionInputSchema.safeParse(input).success).toBe(true);

    const created = await saveSessionIn(database, eventId, input);
    const replayed = await saveSessionIn(database, eventId, input);

    expect(replayed).toEqual(created);
    expect(created).toMatchObject({ id: creationId, slug: "a-retry-safe-session", scheduleRevision: 1 });

    const [sessions, revisions, speakers, outbox] = await Promise.all([
      pg.query<{ count: number }>("SELECT count(*)::int AS count FROM sessions WHERE id=$1", [creationId]),
      pg.query<{ count: number }>("SELECT count(*)::int AS count FROM session_content_revisions WHERE session_id=$1", [creationId]),
      pg.query<{ count: number }>("SELECT count(*)::int AS count FROM session_speakers WHERE session_id=$1", [creationId]),
      pg.query<{ contact_id: string; count: number }>(
        "SELECT contact_id, count(*)::int AS count FROM communication_logs WHERE session_id=$1 GROUP BY contact_id ORDER BY contact_id",
        [creationId],
      ),
    ]);
    expect(sessions.rows[0]?.count).toBe(1);
    expect(revisions.rows[0]?.count).toBe(1);
    expect(speakers.rows[0]?.count).toBe(2);
    expect(outbox.rows).toEqual([
      { contact_id: firstSpeaker, count: 1 },
      { contact_id: secondSpeaker, count: 1 },
    ]);
  });

  it("keeps distinct same-title attempts legitimate and rejects mismatched or cross-event replays", async () => {
    const distinct = await saveSessionIn(database, eventId, { ...input, creationId: distinctCreationId });
    expect(distinct).toMatchObject({ id: distinctCreationId, slug: "a-retry-safe-session-2" });

    const mismatch = await saveSessionIn(database, eventId, { ...input, title: "Changed after sending" })
      .catch((error: unknown) => error);
    expect(isAppError(mismatch) && mismatch.code).toBe("CONFLICT");

    const crossEvent = await saveSessionIn(database, otherEventId, {
      ...input,
      speakerContactIds: [],
    }).catch((error: unknown) => error);
    expect(isAppError(crossEvent) && crossEvent.code).toBe("CONFLICT");
  });
});
