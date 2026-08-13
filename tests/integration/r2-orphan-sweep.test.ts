import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbOrTx } from "@/db/client";
import * as schema from "@/db/schema";
import { parseListObjectsXml, sweepOrphanStagingObjectsIn, type ListObjectsPage } from "@/shared/server/r2";

const migration0 = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");

const EVENT_ID = "55555555-5555-4555-8555-555555555551";

let pglite: PGlite;
let testDb: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  pglite = new PGlite();
  await pglite.exec(migration0);
  await pglite.exec(migration1);
  testDb = drizzle(pglite, { schema });
  await pglite.query(
    "INSERT INTO events(id,name,slug,starts_at,ends_at) VALUES($1,'Sweep Event','sweep-event','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
    [EVENT_ID],
  );
}, 30_000);

afterAll(async () => {
  await pglite.close();
});

async function insertAsset(id: string, r2Key: string) {
  await pglite.query(
    `INSERT INTO file_assets(id,event_id,kind,r2_key,filename,mime,size_bytes)
     VALUES($1,$2,'headshot',$3,'me.png','image/png',1024)`,
    [id, EVENT_ID, r2Key],
  );
}

function page(objects: ListObjectsPage["objects"], nextToken: string | null = null): ListObjectsPage {
  return { objects, nextToken };
}

describe("parseListObjectsXml", () => {
  it("reads Key/LastModified pairs and the continuation token", () => {
    const xml = `<?xml version="1.0"?><ListBucketResult>
      <Contents><Key>evt_1/staging/headshot/a/me.png</Key><LastModified>2026-01-01T00:00:00.000Z</LastModified><Size>10</Size></Contents>
      <Contents><Key>evt_1/headshot/b/you.png</Key><LastModified>2026-02-02T00:00:00.000Z</LastModified><Size>20</Size></Contents>
      <IsTruncated>true</IsTruncated>
      <NextContinuationToken>abc123</NextContinuationToken>
    </ListBucketResult>`;
    const result = parseListObjectsXml(xml);
    expect(result.objects).toEqual([
      { key: "evt_1/staging/headshot/a/me.png", lastModified: new Date("2026-01-01T00:00:00.000Z") },
      { key: "evt_1/headshot/b/you.png", lastModified: new Date("2026-02-02T00:00:00.000Z") },
    ]);
    expect(result.nextToken).toBe("abc123");
  });

  it("decodes XML entities in a key and returns a null token when the list is not truncated", () => {
    const xml = `<ListBucketResult>
      <Contents><Key>evt_1/staging/upload/a/Q%26A.txt</Key><LastModified>2026-01-01T00:00:00.000Z</LastModified></Contents>
    </ListBucketResult>`.replace("Q%26A", "Q&amp;A");
    const result = parseListObjectsXml(xml);
    expect(result.objects[0]?.key).toBe("evt_1/staging/upload/a/Q&A.txt");
    expect(result.nextToken).toBeNull();
  });

  it("returns no objects for an empty bucket listing", () => {
    expect(parseListObjectsXml("<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>")).toEqual({
      objects: [],
      nextToken: null,
    });
  });
});

describe("sweepOrphanStagingObjectsIn", () => {
  it("degrades gracefully and never lists or deletes when S3 credentials are absent", async () => {
    let listed = false;
    let deleted = false;
    const result = await sweepOrphanStagingObjectsIn(testDb as unknown as DbOrTx, 24, {
      hasCredentials: () => false,
      listPage: async () => {
        listed = true;
        return page([]);
      },
      deleteKey: async () => {
        deleted = true;
        return true;
      },
    });
    expect(result).toEqual({ deleted: 0, scanned: 0, skipped: true });
    expect(listed).toBe(false);
    expect(deleted).toBe(false);
  });

  it("deletes a stale staging object no row points to, and spares one a row still owns", async () => {
    const owned = "55555555-5555-4555-8555-000000000001";
    await insertAsset(owned, "evt_1/staging/headshot/owned/me.png");

    const old = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const recent = new Date().toISOString();
    const deletedKeys: string[] = [];
    const result = await sweepOrphanStagingObjectsIn(testDb as unknown as DbOrTx, 24, {
      hasCredentials: () => true,
      listPage: async () => page([
        // Stale, no matching row: the real orphan.
        { key: "evt_1/staging/headshot/gone/deleted-row.png", lastModified: new Date(old) },
        // Stale, but a row's r2_key still equals this exact staging key: still mid-upload.
        { key: "evt_1/staging/headshot/owned/me.png", lastModified: new Date(old) },
        // Fresh, no matching row: too young to touch.
        { key: "evt_1/staging/headshot/fresh/new.png", lastModified: new Date(recent) },
        // Not a staging key at all: never a candidate.
        { key: "evt_1/headshot/published/keep.png", lastModified: new Date(old) },
      ]),
      deleteKey: async (key) => {
        deletedKeys.push(key);
        return true;
      },
    });

    expect(deletedKeys).toEqual(["evt_1/staging/headshot/gone/deleted-row.png"]);
    expect(result).toEqual({ deleted: 1, scanned: 4, skipped: false });
  });

  it("logs but does not throw when deletes resolve false or reject", async () => {
    const result = await sweepOrphanStagingObjectsIn(testDb as unknown as DbOrTx, 24, {
      hasCredentials: () => true,
      listPage: async () => page([
        { key: "evt_1/staging/upload/stranded/false.pdf", lastModified: new Date(0) },
        { key: "evt_1/staging/upload/stranded/rejected.pdf", lastModified: new Date(0) },
      ]),
      deleteKey: async (key) => {
        if (key.endsWith("rejected.pdf")) throw new Error("R2 unavailable");
        return false;
      },
    });
    expect(result).toEqual({ deleted: 0, scanned: 2, skipped: false });
  });

  it("paginates until the listing stops returning a continuation token", async () => {
    let calls = 0;
    const result = await sweepOrphanStagingObjectsIn(testDb as unknown as DbOrTx, 24, {
      hasCredentials: () => true,
      listPage: async (token) => {
        calls += 1;
        if (!token) return page([{ key: "evt_1/staging/upload/p1/a.pdf", lastModified: new Date(0) }], "next-page");
        return page([{ key: "evt_1/staging/upload/p2/b.pdf", lastModified: new Date(0) }], null);
      },
      deleteKey: async () => true,
    });
    expect(calls).toBe(2);
    expect(result).toEqual({ deleted: 2, scanned: 2, skipped: false });
  });
});
