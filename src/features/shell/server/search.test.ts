import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eventIdSchema } from "@/shared/contracts";
import { searchEventEntitiesIn } from "./search";

const migration0 = readFileSync(new URL("../../../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");

const EVENT = eventIdSchema.parse("c0000000-0000-4000-8000-000000000001");
const OTHER_EVENT = eventIdSchema.parse("c0000000-0000-4000-8000-000000000002");

let pg: PGlite;

describe("search event entities", () => {
  beforeAll(async () => {
    pg = new PGlite();
    await pg.exec(migration0);
    await pg.exec(migration1);

    await pg.query(
      `INSERT INTO events(id,name,slug,timezone,starts_at,ends_at) VALUES
        ($1,'SearchConf','search-conf','America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z'),
        ($2,'OtherConf','other-search-conf','America/New_York','2026-10-01T13:00:00Z','2026-10-01T22:00:00Z')`,
      [EVENT, OTHER_EVENT],
    );
    await pg.query(
      `INSERT INTO submissions(id,event_id,code,status,source,title,submitted_at) VALUES
        ('c0000000-0000-4000-8000-000000000010',$1,42,'accepted','cfp','Scaling Postgres to a Billion Rows','2026-08-01T00:00:00Z'),
        ('c0000000-0000-4000-8000-000000000011',$1,7,'draft','cfp','Never submitted','2026-08-01T00:00:00Z'),
        ('c0000000-0000-4000-8000-000000000013',$1,99,'accept_queue','cfp','Queued keynote','2026-08-01T00:00:00Z'),
        ('c0000000-0000-4000-8000-000000000012',$2,42,'accepted','cfp','Wrong event, same code','2026-08-01T00:00:00Z')`,
      [EVENT, OTHER_EVENT],
    );
    await pg.query(
      `INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES
        ('c0000000-0000-4000-8000-000000000020',$1,'ada@example.com','Ada','Lovelace')`,
      [EVENT],
    );
    await pg.query(
      `INSERT INTO sessions(id,event_id,title,slug,status) VALUES
        ('c0000000-0000-4000-8000-000000000030',$1,'Postgres at Scale',  'postgres-at-scale','published')`,
      [EVENT],
    );
  });

  afterAll(async () => {
    await pg.close();
  });

  it("finds a submission by title fragment", async () => {
    const db = drizzle(pg);
    const results = await searchEventEntitiesIn(db, EVENT, "billion rows");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ type: "submission", label: "Scaling Postgres to a Billion Rows" });
  });

  it("finds a submission by bare numeric code, scoped to the event", async () => {
    const db = drizzle(pg);
    const results = await searchEventEntitiesIn(db, EVENT, "42");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ sublabel: "SESS-42", status: "accepted" });
  });

  // The palette authors the words for a status (`searchResultHint`); this
  // module hands over the column value and no vocabulary of its own.
  it("carries the row's status for the palette to label", async () => {
    const db = drizzle(pg);
    const results = await searchEventEntitiesIn(db, EVENT, "queued keynote");
    expect(results[0]).toMatchObject({ sublabel: "SESS-99", status: "accept_queue" });
  });

  it("excludes drafts and never leaks another event's rows", async () => {
    const db = drizzle(pg);
    expect(await searchEventEntitiesIn(db, EVENT, "never submitted")).toHaveLength(0);
    // "42" also exists as a code in OTHER_EVENT, but scoped to EVENT it must
    // resolve to the one submission that belongs to it.
    const results = await searchEventEntitiesIn(db, EVENT, "42");
    expect(results.every((r) => r.href.includes(String(EVENT)))).toBe(true);
  });

  it("finds a speaker by name and a session by title", async () => {
    const db = drizzle(pg);
    const speaker = await searchEventEntitiesIn(db, EVENT, "lovelace");
    expect(speaker).toEqual([{ type: "speaker", id: "c0000000-0000-4000-8000-000000000020", label: "Ada Lovelace", sublabel: "ada@example.com", status: null, href: `/events/${EVENT}/speakers/c0000000-0000-4000-8000-000000000020` }]);

    const session = await searchEventEntitiesIn(db, EVENT, "postgres at scale");
    expect(session).toEqual([{ type: "session", id: "c0000000-0000-4000-8000-000000000030", label: "Postgres at Scale", sublabel: null, status: "published", href: `/events/${EVENT}/agenda?view=list&session=c0000000-0000-4000-8000-000000000030` }]);
  });

  it("returns nothing for a query shorter than two characters", async () => {
    const db = drizzle(pg);
    expect(await searchEventEntitiesIn(db, EVENT, "a")).toEqual([]);
    expect(await searchEventEntitiesIn(db, EVENT, "")).toEqual([]);
  });
});
