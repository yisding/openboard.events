import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

type MigrationJournal = {
  entries: Array<{
    idx: number;
    tag: string;
  }>;
};

export type ProductMigration = {
  sql: string;
  tag: string;
};

type SqlExecutor = {
  exec(sql: string): Promise<unknown>;
};

export function readProductMigrations(repoRoot = process.cwd()): ProductMigration[] {
  const migrationRoot = resolve(repoRoot, "drizzle");
  const journal = JSON.parse(
    readFileSync(resolve(migrationRoot, "meta/_journal.json"), "utf8"),
  ) as MigrationJournal;
  const journalTags = journal.entries.map((entry, index) => {
    const prefix = index.toString().padStart(4, "0");
    if (entry.idx !== index || !entry.tag.startsWith(`${prefix}_`)) {
      throw new Error(`invalid migration journal entry at position ${index + 1}`);
    }
    return entry.tag;
  });
  const migrationTags = readdirSync(migrationRoot)
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .map((name) => name.slice(0, -4))
    .sort();

  if (JSON.stringify(migrationTags) !== JSON.stringify(journalTags)) {
    throw new Error("migration files and drizzle/meta/_journal.json differ");
  }

  return journalTags.map((tag) => ({
    tag,
    sql: readFileSync(resolve(migrationRoot, `${tag}.sql`), "utf8"),
  }));
}

export async function applyProductMigrations(
  database: SqlExecutor,
  repoRoot = process.cwd(),
): Promise<void> {
  for (const migration of readProductMigrations(repoRoot)) {
    await database.exec(migration.sql);
  }
}
