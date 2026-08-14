import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbOrTx } from "@/db/client";
import * as schema from "@/db/schema";
import {
  buildLegacyStagingKey,
  buildObjectKey,
  buildStagingKey,
  migrateLegacyStagingIn,
  type ListObjectsPage,
} from "@/shared/server/r2";
import type { EventId } from "@/shared/contracts";

const migration0 = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");
const migration6 = readFileSync(new URL("../../drizzle/0006_content_deliverables.sql", import.meta.url), "utf8");
const migration19 = readFileSync(new URL("../../drizzle/0019_scheduled_job_heartbeats.sql", import.meta.url), "utf8");
const migration42 = readFileSync(new URL("../../drizzle/0042_r2_staging_migration_state.sql", import.meta.url), "utf8");

const EVENT_ID = "77777777-7777-4777-8777-777777777771" as EventId;
const FILE_ID = "77777777-7777-4777-8777-777777777772";
const NOW = new Date("2026-08-14T18:30:00.000Z");

let pglite: PGlite;
let testDb: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  pglite = new PGlite();
  await pglite.exec(migration0);
  await pglite.exec(migration1);
  await pglite.exec(migration6);
  await pglite.exec(migration19);
  await pglite.exec(migration42);
  testDb = drizzle(pglite, { schema });
  await pglite.query(
    "INSERT INTO events(id,name,slug,starts_at,ends_at) VALUES($1,'Migration Event','migration-event','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
    [EVENT_ID],
  );
}, 30_000);

beforeEach(async () => {
  await pglite.exec("DELETE FROM r2_staging_migration_state; DELETE FROM scheduled_job_heartbeats; DELETE FROM file_assets;");
});

afterAll(async () => {
  await pglite.close();
});

function keys(fileId = FILE_ID) {
  const input = { eventId: EVENT_ID, kind: "headshot" as const, fileId, filename: "me.png" };
  return {
    legacy: buildLegacyStagingKey(input),
    current: buildStagingKey(input),
    published: buildObjectKey(input),
  };
}

async function insertLegacyAsset(createdAt = "2026-08-14T17:00:00.000Z") {
  await pglite.query(
    `INSERT INTO file_assets(id,event_id,kind,r2_key,filename,mime,size_bytes,created_at)
     VALUES($1,$2,'headshot',$3,'me.png','image/png',8,$4)`,
    [FILE_ID, EVENT_ID, keys().legacy, createdAt],
  );
}

function emptyPage(): ListObjectsPage {
  return { objects: [], nextToken: null };
}

describe("version-1 R2 staging migration", () => {
  it("allows the temporary migration job to record its durable heartbeat", async () => {
    await pglite.query(
      `INSERT INTO scheduled_job_heartbeats(job_name,last_succeeded_at,last_duration_ms)
       VALUES('r2-migration',$1,25)`,
      [NOW.toISOString()],
    );

    const heartbeat = await pglite.query<{ job_name: string }>(
      "SELECT job_name FROM scheduled_job_heartbeats WHERE job_name='r2-migration'",
    );
    expect(heartbeat.rows).toEqual([{ job_name: "r2-migration" }]);
  });

  it("copies and fingerprints a live row before the database CAS and source delete", async () => {
    await insertLegacyAsset();
    const objects = new Map([[keys().legacy, { size: 8, etag: "same-etag" }]]);

    const result = await migrateLegacyStagingIn(testDb as unknown as DbOrTx, {
      now: () => NOW,
      presignGraceMinutes: 0,
      headObject: async (key) => objects.get(key) ?? null,
      copyKey: async (source, destination) => {
        const object = objects.get(source);
        if (!object) throw new Error("missing source");
        objects.set(destination, object);
      },
      deleteKey: async (key) => objects.delete(key) || !objects.has(key),
      listPage: async () => emptyPage(),
    });

    const row = await pglite.query<{ r2_key: string }>("SELECT r2_key FROM file_assets WHERE id=$1", [FILE_ID]);
    expect(row.rows[0]?.r2_key).toBe(keys().current);
    expect(objects.has(keys().legacy)).toBe(false);
    expect(objects.get(keys().current)).toEqual({ size: 8, etag: "same-etag" });
    expect(result).toMatchObject({
      legacyRowsMigrated: 1,
      legacyRowsRemaining: 0,
      legacyObjectsRemaining: 0,
      migrationFailures: 0,
      migrationComplete: 1,
    });
  });

  it("leaves the row on version 1 and removes a copy whose ETag does not match", async () => {
    await insertLegacyAsset();
    const objects = new Map<string, { size: number; etag: string }>([
      [keys().legacy, { size: 8, etag: "source" }],
    ]);

    const result = await migrateLegacyStagingIn(testDb as unknown as DbOrTx, {
      now: () => NOW,
      presignGraceMinutes: 0,
      headObject: async (key) => objects.get(key) ?? null,
      copyKey: async (_source, destination) => {
        objects.set(destination, { size: 8, etag: "different" });
      },
      deleteKey: async (key) => objects.delete(key) || !objects.has(key),
      listPage: async () => emptyPage(),
    });

    const row = await pglite.query<{ r2_key: string }>("SELECT r2_key FROM file_assets WHERE id=$1", [FILE_ID]);
    expect(row.rows[0]?.r2_key).toBe(keys().legacy);
    expect(objects.has(keys().current)).toBe(false);
    expect(result).toMatchObject({ legacyRowsRemaining: 1, migrationFailures: 1, migrationComplete: 0 });
  });

  it("deletes an expired unowned presign row when its source object never arrived", async () => {
    await insertLegacyAsset();
    const result = await migrateLegacyStagingIn(testDb as unknown as DbOrTx, {
      now: () => NOW,
      presignGraceMinutes: 0,
      headObject: async () => null,
      copyKey: async () => undefined,
      deleteKey: async () => true,
      listPage: async () => emptyPage(),
    });

    const row = await pglite.query("SELECT id FROM file_assets WHERE id=$1", [FILE_ID]);
    expect(row.rows).toHaveLength(0);
    expect(result).toMatchObject({ legacyRowsDeletedMissingSource: 1, migrationComplete: 1 });
  });

  it("does not delete a sibling migration's destination when the row CAS loses", async () => {
    await insertLegacyAsset();
    const objects = new Map([[keys().legacy, { size: 8, etag: "same-etag" }]]);

    const result = await migrateLegacyStagingIn(testDb as unknown as DbOrTx, {
      now: () => NOW,
      presignGraceMinutes: 0,
      headObject: async (key) => objects.get(key) ?? null,
      copyKey: async (source, destination) => {
        const object = objects.get(source);
        if (!object) throw new Error("missing source");
        objects.set(destination, object);
        await pglite.query("UPDATE file_assets SET r2_key=$1 WHERE id=$2", [destination, FILE_ID]);
      },
      deleteKey: async (key) => objects.delete(key) || !objects.has(key),
      listPage: async () => emptyPage(),
    });

    expect(objects.has(keys().current)).toBe(true);
    expect(result).toMatchObject({ legacyRowsRemaining: 0, migrationFailures: 0, migrationComplete: 1 });
  });

  it("persists an opaque inventory cursor and deletes an unowned legacy object on the next tick", async () => {
    const orphan = keys("77777777-7777-4777-8777-777777777799").legacy;
    const seenTokens: Array<string | undefined> = [];
    const deleted: string[] = [];
    const listPage = async (token?: string): Promise<ListObjectsPage> => {
      seenTokens.push(token);
      return token === "second"
        ? { objects: [{ key: orphan, lastModified: new Date("2026-08-14T17:00:00.000Z") }], nextToken: null }
        : { objects: [{ key: keys().published, lastModified: NOW }], nextToken: "second" };
    };
    const options = {
      now: () => NOW,
      presignGraceMinutes: 0,
      headObject: async () => null,
      copyKey: async () => undefined,
      deleteKey: async (key: string) => {
        deleted.push(key);
        return true;
      },
      listPage,
      maxInventoryPages: 1,
    };

    const first = await migrateLegacyStagingIn(testDb as unknown as DbOrTx, options);
    expect(first).toMatchObject({ migrationComplete: 0, checkpointWritten: 1 });
    const second = await migrateLegacyStagingIn(testDb as unknown as DbOrTx, options);

    expect(seenTokens).toEqual([undefined, "second"]);
    expect(deleted).toEqual([orphan]);
    expect(second).toMatchObject({
      legacyObjectsFound: 1,
      legacyObjectsDeleted: 1,
      legacyObjectsRemaining: 0,
      migrationComplete: 1,
    });
    const state = await pglite.query<{ complete: boolean; cursor: string | null }>(
      "SELECT complete,cursor FROM r2_staging_migration_state WHERE singleton",
    );
    expect(state.rows[0]).toMatchObject({ complete: true, cursor: null });
  });

  it("rescans after the presign window and catches an object recreated behind an early zero", async () => {
    const orphan = keys("77777777-7777-4777-8777-777777777798").legacy;
    let current = NOW;
    const objects = new Map<string, Date>();
    const deleted: string[] = [];
    const options = {
      now: () => current,
      headObject: async () => null,
      copyKey: async () => undefined,
      deleteKey: async (key: string) => {
        deleted.push(key);
        objects.delete(key);
        return true;
      },
      listPage: async (): Promise<ListObjectsPage> => ({
        objects: [...objects].map(([key, lastModified]) => ({ key, lastModified })),
        nextToken: null,
      }),
    };

    const earlyZero = await migrateLegacyStagingIn(testDb as unknown as DbOrTx, options);
    expect(earlyZero.migrationComplete).toBe(0);

    objects.set(orphan, new Date(NOW.getTime() + 14 * 60 * 1000));
    current = new Date(NOW.getTime() + 16 * 60 * 1000);
    const recreated = await migrateLegacyStagingIn(testDb as unknown as DbOrTx, options);
    expect(recreated).toMatchObject({
      legacyObjectsFound: 1,
      legacyObjectsRemaining: 1,
      migrationComplete: 0,
    });

    current = new Date(NOW.getTime() + 30 * 60 * 1000);
    const expired = await migrateLegacyStagingIn(testDb as unknown as DbOrTx, options);
    expect(deleted).toEqual([orphan]);
    expect(expired).toMatchObject({
      legacyObjectsDeleted: 1,
      legacyObjectsRemaining: 0,
      migrationComplete: 1,
    });
  });
});
