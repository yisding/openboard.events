import { readFileSync } from "node:fs";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { describe, expect, it } from "vitest";
import { journalTimestampRepairs } from "../../scripts/reconcile-drizzle-journal";

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

  it("repairs only hash-verified applied rows", () => {
    const local = readMigrationFiles({ migrationsFolder: "drizzle" });
    const applied = local.slice(0, 2).map((migration, index) => ({
      id: index + 7,
      hash: migration.hash,
      created_at: migration.folderMillis + 99,
    }));
    expect(journalTimestampRepairs(local, applied)).toEqual(applied.map((row, index) => ({
      id: row.id,
      hash: row.hash,
      createdAt: local[index]?.folderMillis,
    })));
    const firstApplied = applied[0];
    expect(firstApplied).toBeDefined();
    if (!firstApplied) throw new Error("expected a migration fixture");
    expect(() => journalTimestampRepairs(local, [{ ...firstApplied, hash: "wrong" }])).toThrow(/hash mismatch/);
    expect(() => journalTimestampRepairs(local.slice(0, 1), applied)).toThrow(/database has 2 migrations/);
  });
});
