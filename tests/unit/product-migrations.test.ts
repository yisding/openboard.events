import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readProductMigrations } from "../../scripts/lib/product-migrations";

const CACHE_ROOT = resolve("node_modules/.cache");
const fixtures: string[] = [];

function fixture(entries: Array<{ idx: number; tag: string }>, files: string[]): string {
  mkdirSync(CACHE_ROOT, { recursive: true });
  const root = mkdtempSync(resolve(CACHE_ROOT, "product-migrations-"));
  fixtures.push(root);
  mkdirSync(resolve(root, "drizzle/meta"), { recursive: true });
  writeFileSync(
    resolve(root, "drizzle/meta/_journal.json"),
    JSON.stringify({ entries }),
  );
  for (const file of files) writeFileSync(resolve(root, `drizzle/${file}.sql`), `-- ${file}\n`);
  return root;
}

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("product migration journal", () => {
  it("loads every repository migration in journal order", () => {
    const migrations = readProductMigrations();
    expect(migrations.length).toBeGreaterThan(0);
    expect(migrations[0]?.tag).toBe("0000_init");
    expect(migrations.every((migration) => migration.sql.trim().length > 0)).toBe(true);
  });

  it("rejects a journal position that does not match its numbered tag", () => {
    const root = fixture([{ idx: 1, tag: "0000_init" }], ["0000_init"]);
    expect(() => readProductMigrations(root)).toThrow("invalid migration journal entry");
  });

  it("rejects migration files that are absent from the journal", () => {
    const root = fixture([{ idx: 0, tag: "0000_init" }], ["0000_init", "0001_extra"]);
    expect(() => readProductMigrations(root)).toThrow("migration files and drizzle/meta/_journal.json differ");
  });
});
