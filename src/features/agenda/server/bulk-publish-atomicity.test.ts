import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import { contactIdSchema, eventIdSchema, sessionIdSchema } from "@/shared/contracts";
import { bulkSetPublishedIn } from "./mutations";

const migration0 = readFileSync(new URL("../../../../drizzle/0000_init.sql", import.meta.url), "utf8");

const eventId = eventIdSchema.parse("a1000000-0000-4000-8000-000000000001");
const firstSession = sessionIdSchema.parse("a2000000-0000-4000-8000-000000000001");
const secondSession = sessionIdSchema.parse("a2000000-0000-4000-8000-000000000002");
const firstSpeaker = contactIdSchema.parse("a3000000-0000-4000-8000-000000000001");
const secondSpeaker = contactIdSchema.parse("a3000000-0000-4000-8000-000000000002");

describe("atomic bulk schedule publication", () => {
  let pg: PGlite;

  beforeAll(async () => {
    pg = new PGlite();
    await pg.exec(migration0);
    await pg.query(
      `INSERT INTO events(id,name,slug,timezone,starts_at,ends_at)
       VALUES ($1,'Atomic Conf','atomic-conf','America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')`,
      [eventId],
    );
    await pg.query(
      `INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES
       ($1,$3,'ada@example.com','Ada','Lovelace'),
       ($2,$3,'grace@example.com','Grace','Hopper')`,
      [firstSpeaker, secondSpeaker, eventId],
    );
    await pg.query(
      `INSERT INTO sessions(id,event_id,title,slug,status,starts_at,ends_at) VALUES
       ($1,$3,'Opening','opening','draft','2026-09-16T17:00:00Z','2026-09-16T17:30:00Z'),
       ($2,$3,'Closing','closing','draft','2026-09-16T23:00:00Z','2026-09-16T23:30:00Z')`,
      [firstSession, secondSession, eventId],
    );
    await pg.query(
      `INSERT INTO session_speakers(event_id,session_id,contact_id,sort_order) VALUES
       ($1,$2,$3,0),($1,$4,$5,0)`,
      [eventId, firstSession, firstSpeaker, secondSession, secondSpeaker],
    );
  });

  afterAll(async () => pg.close());

  it("rolls back every published row and email when a later enqueue fails, then retries idempotently", async () => {
    const database = drizzle(pg, { schema });
    await pg.exec(`
      CREATE FUNCTION fail_second_schedule_email() RETURNS trigger AS $$
      BEGIN
        IF EXISTS (SELECT 1 FROM communication_logs WHERE event_id = NEW.event_id) THEN
          RAISE EXCEPTION 'forced later enqueue failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_second_schedule_email
      BEFORE INSERT ON communication_logs
      FOR EACH ROW EXECUTE FUNCTION fail_second_schedule_email();
    `);

    await expect(database.transaction((tx) => bulkSetPublishedIn(
      tx as unknown as TxDb,
      eventId,
      [firstSession, secondSession],
      true,
    ))).rejects.toThrow('Failed query: insert into "communication_logs"');

    const afterFailure = await pg.query<{ status: string; schedule_revision: number }>(
      "SELECT status, schedule_revision FROM sessions WHERE event_id=$1 ORDER BY id",
      [eventId],
    );
    const failedLogs = await pg.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM communication_logs WHERE event_id=$1",
      [eventId],
    );
    expect(afterFailure.rows).toEqual([
      { status: "draft", schedule_revision: 0 },
      { status: "draft", schedule_revision: 0 },
    ]);
    expect(failedLogs.rows[0]?.count).toBe(0);

    await pg.exec("DROP TRIGGER fail_second_schedule_email ON communication_logs; DROP FUNCTION fail_second_schedule_email();");
    const published = await database.transaction((tx) => bulkSetPublishedIn(
      tx as unknown as TxDb,
      eventId,
      [firstSession, secondSession],
      true,
    ));
    const retried = await database.transaction((tx) => bulkSetPublishedIn(
      tx as unknown as TxDb,
      eventId,
      [firstSession, secondSession],
      true,
    ));
    const committedLogs = await pg.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM communication_logs WHERE event_id=$1",
      [eventId],
    );

    expect(published).toEqual({ changed: 2, emailsQueued: 2 });
    expect(retried).toEqual({ changed: 0, emailsQueued: 0 });
    expect(committedLogs.rows[0]?.count).toBe(2);
  });
});
