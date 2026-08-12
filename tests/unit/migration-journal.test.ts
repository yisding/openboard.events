import { readFileSync } from "node:fs";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { describe, expect, it } from "vitest";
import { databaseCompatibleMigrationTimestamps } from "../../scripts/migrate-database";

const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as {
  entries: Array<{ idx: number; when: number; tag: string }>;
};

describe("Drizzle migration journal", () => {
  it("uses ordered, non-future timestamps and matching tags", () => {
    const timestamps = journal.entries.map((entry) => entry.when);
    expect(journal.entries.map((entry) => entry.idx)).toEqual(journal.entries.map((_entry, index) => index));
    expect(journal.entries.every((entry) => entry.tag.startsWith(`${entry.idx.toString().padStart(4, "0")}_`))).toBe(true);
    expect(timestamps.every((timestamp, index) => index === 0 || timestamp > (timestamps[index - 1] ?? 0))).toBe(true);
    expect(timestamps.every((timestamp) => timestamp <= Date.now())).toBe(true);
  });

  it("uses a compatibility journal without lowering the database high-water mark", () => {
    const local = readMigrationFiles({ migrationsFolder: "drizzle" });
    const applied = local.slice(0, 2).map((migration, index) => ({
      id: index + 7,
      hash: migration.hash,
      created_at: migration.folderMillis + 1_000_000,
    }));
    const databaseHighWater = Number(applied.at(-1)?.created_at);
    const timestamps = databaseCompatibleMigrationTimestamps(local, applied);
    expect(timestamps.slice(0, applied.length).every((timestamp) => timestamp <= databaseHighWater)).toBe(true);
    expect(timestamps[applied.length]).toBeGreaterThan(databaseHighWater);
    expect(applied.at(-1)?.created_at).toBe(databaseHighWater);

    const firstApplied = applied[0];
    expect(firstApplied).toBeDefined();
    if (!firstApplied) throw new Error("expected a migration fixture");
    expect(() => databaseCompatibleMigrationTimestamps(local, [{ ...firstApplied, hash: "wrong" }]))
      .toThrow(/hash mismatch/);
    expect(() => databaseCompatibleMigrationTimestamps(local.slice(0, 1), applied))
      .toThrow(/database has 2 migrations/);
    expect(() => databaseCompatibleMigrationTimestamps(local, [{ ...firstApplied, created_at: "invalid" }]))
      .toThrow(/invalid database migration timestamp/);
  });
});
