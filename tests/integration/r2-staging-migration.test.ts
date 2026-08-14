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
import { applyProductMigrations } from "../../scripts/lib/product-migrations";

const EVENT_ID = "77777777-7777-4777-8777-777777777771" as EventId;
const FILE_ID = "77777777-7777-4777-8777-777777777772";
const NOW = new Date("2026-08-14T18:30:00.000Z");

let pglite: PGlite;
let testDb: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  pglite = new PGlite();
  await applyProductMigrations(pglite);
  testDb = drizzle(pglite, { schema });
  await pglite.query(
    "INSERT INTO events(id,name,slug,starts_at,ends_at) VALUES($1,'Migration Event','migration-event','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
    [EVENT_ID],
  );
}, 120_000);

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

async function insertLegacyAsset(
  createdAt = "2026-08-14T17:00:00.000Z",
  fileId = FILE_ID,
) {
  await pglite.query(
    `INSERT INTO file_assets(id,event_id,kind,r2_key,filename,mime,size_bytes,created_at)
     VALUES($1,$2,'headshot',$3,'me.png','image/png',8,$4)`,
    [fileId, EVENT_ID, keys(fileId).legacy, createdAt],
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

  it("leaves the row on version 1 and defers mismatched-copy cleanup to lifecycle", async () => {
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
    expect(objects.has(keys().current)).toBe(true);
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

  it("rejects a stale checkpoint write without moving a sibling's cursor backwards", async () => {
    await pglite.query(
      `INSERT INTO r2_staging_migration_state(singleton,started_at)
       VALUES(true,$1)`,
      [NOW.toISOString()],
    );
    const result = await migrateLegacyStagingIn(testDb as unknown as DbOrTx, {
      now: () => NOW,
      presignGraceMinutes: 0,
      headObject: async () => null,
      copyKey: async () => undefined,
      deleteKey: async () => true,
      maxInventoryPages: 1,
      listPage: async () => {
        await pglite.query(
          "UPDATE r2_staging_migration_state SET cursor='winner',row_version=row_version+1 WHERE singleton",
        );
        return { objects: [], nextToken: "loser" };
      },
    });

    const state = await pglite.query<{ cursor: string; row_version: number }>(
      "SELECT cursor,row_version FROM r2_staging_migration_state WHERE singleton",
    );
    expect(result.checkpointWritten).toBe(0);
    expect(state.rows[0]).toEqual({ cursor: "winner", row_version: 1 });
  });

  it("returns a completed checkpoint without listing the bucket again", async () => {
    await pglite.query(
      `INSERT INTO r2_staging_migration_state(singleton,complete,started_at,completed_at)
       VALUES(true,true,$1,$2)`,
      [NOW.toISOString(), new Date(NOW.getTime() + 15 * 60 * 1000).toISOString()],
    );
    let listed = false;
    const result = await migrateLegacyStagingIn(testDb as unknown as DbOrTx, {
      now: () => new Date(NOW.getTime() + 16 * 60 * 1000),
      headObject: async () => null,
      copyKey: async () => undefined,
      deleteKey: async () => true,
      listPage: async () => {
        listed = true;
        return emptyPage();
      },
    });

    expect(listed).toBe(false);
    expect(result.migrationComplete).toBe(1);
  });

  it("advances past a corrupt row so later valid rows can still migrate", async () => {
    const laterFileId = "77777777-7777-4777-8777-777777777773";
    await insertLegacyAsset(undefined, FILE_ID);
    await insertLegacyAsset(undefined, laterFileId);
    await pglite.query("UPDATE file_assets SET filename='does-not-match.png' WHERE id=$1", [FILE_ID]);
    const objects = new Map([
      [keys(FILE_ID).legacy, { size: 8, etag: "invalid-row" }],
      [keys(laterFileId).legacy, { size: 8, etag: "later-row" }],
    ]);
    const options = {
      now: () => NOW,
      batchSize: 1,
      presignGraceMinutes: 0,
      headObject: async (key: string) => objects.get(key) ?? null,
      copyKey: async (source: string, destination: string) => {
        const object = objects.get(source);
        if (!object) throw new Error("missing source");
        objects.set(destination, object);
      },
      deleteKey: async (key: string) => objects.delete(key) || !objects.has(key),
      listPage: async () => emptyPage(),
    };

    const blocked = await migrateLegacyStagingIn(testDb as unknown as DbOrTx, options);
    const progressed = await migrateLegacyStagingIn(testDb as unknown as DbOrTx, options);
    const rows = await pglite.query<{ id: string; r2_key: string }>(
      "SELECT id,r2_key FROM file_assets ORDER BY id",
    );

    expect(blocked).toMatchObject({ legacyRowsProcessed: 1, migrationFailures: 1 });
    expect(progressed).toMatchObject({ legacyRowsMigrated: 1, legacyRowsRemaining: 1 });
    expect(rows.rows).toEqual([
      { id: FILE_ID, r2_key: keys(FILE_ID).legacy },
      { id: laterFileId, r2_key: keys(laterFileId).current },
    ]);
  });
});
