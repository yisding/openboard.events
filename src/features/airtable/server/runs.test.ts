import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbOrTx } from "@/db/client";
import * as schema from "@/db/schema";
import { eventIdSchema } from "@/shared/contracts";
import { claimSyncRunIn, finishSyncRunIn, listSyncRunsIn, reapExpiredSyncRunsIn } from "./runs";
import { emptySyncRunStats } from "../schemas";

const migration0 = readFileSync(new URL("../../../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration45 = readFileSync(new URL("../../../../drizzle/0045_airtable_connections.sql", import.meta.url), "utf8");

const eventId = eventIdSchema.parse("a17b0000-0000-4000-8000-0000000000e1");
const trackId = "a17b0000-0000-4000-8000-0000000000a1";
const contactId = "a17b0000-0000-4000-8000-0000000000c1";
const sessionId = "a17b0000-0000-4000-8000-0000000000b1";

let pglite: PGlite;
let db: DbOrTx;

describe("Airtable sync-run lifecycle (M39)", () => {
  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migration0);
    await pglite.exec(migration45);
    db = drizzle(pglite, { schema }) as unknown as DbOrTx;
    await pglite.query(
      "INSERT INTO events(id,name,slug,timezone,starts_at,ends_at) VALUES($1,'E','e1','UTC','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
      [eventId],
    );
    await pglite.query("INSERT INTO tracks(id,event_id,name) VALUES($1,$2,'Platform')", [trackId, eventId]);
    await pglite.query("INSERT INTO contacts(id,event_id,email,first_name,last_name,bio_html) VALUES($1,$2,'a@b.co','Ada','Lovelace','<p>Hi &amp; hello</p>')", [contactId, eventId]);
    await pglite.query("INSERT INTO sessions(id,event_id,title,slug,track_id) VALUES($1,$2,'Talk','talk',$3)", [sessionId, eventId, trackId]);
    await pglite.query("INSERT INTO session_speakers(event_id,session_id,contact_id) VALUES($1,$2,$3)", [eventId, sessionId, contactId]);
  }, 60_000);

  afterAll(async () => pglite.close());
  it("enforces one live run per event and reaps an expired lease", async () => {
    const runId = await claimSyncRunIn(db, eventId, "manual", 600_000);
    await expect(claimSyncRunIn(db, eventId, "cron", 600_000)).rejects.toThrow(/already running/u);
    await pglite.query("UPDATE airtable_sync_runs SET lease_expires_at = now() - interval '1 minute' WHERE id = $1", [runId]);
    expect(await reapExpiredSyncRunsIn(db, eventId)).toBe(1);
    const second = await claimSyncRunIn(db, eventId, "cron", 600_000);
    await finishSyncRunIn(db, eventId, second, { status: "success", stats: emptySyncRunStats() });
    const runs = await listSyncRunsIn(db, eventId, 10);
    expect(runs.map((run) => run.status)).toEqual(["success", "failed"]);
    expect(runs[1]?.error).toMatch(/picks up where it left off/u);
  });
});
