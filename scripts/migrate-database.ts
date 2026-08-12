import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { neon } from "@neondatabase/serverless";
import { readMigrationFiles, type MigrationMeta } from "drizzle-orm/migrator";

export type AppliedMigration = {
  id: number;
  hash: string;
  created_at: string | number;
};

type Journal = {
  entries: Array<{ idx: number; when: number; tag: string }>;
};

/**
 * Build timestamps for an ephemeral Drizzle journal without rewriting the
 * database high-water mark. Applied hashes must match in order; pending
 * migrations are lifted above a legacy future-dated high-water mark so both
 * this checkout and older rollback checkouts remain safe.
 */
export function databaseCompatibleMigrationTimestamps(
  local: Pick<MigrationMeta, "hash" | "folderMillis">[],
  applied: AppliedMigration[],
): number[] {
  if (applied.length > local.length) {
    throw new Error(`database has ${applied.length} migrations but this checkout has only ${local.length}`);
  }
  applied.forEach((row, index) => {
    if (row.hash !== local[index]?.hash) {
      throw new Error(`migration hash mismatch at applied position ${index + 1}; refusing migration`);
    }
  });
  if (applied.length === 0) return local.map((migration) => migration.folderMillis);

  const appliedTimestamps = applied.map((row, index) => {
    const timestamp = Number(row.created_at);
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
      throw new Error(`invalid database migration timestamp at applied position ${index + 1}`);
    }
    return timestamp;
  });
  const databaseHighWater = Math.max(...appliedTimestamps);
  let nextTimestamp = databaseHighWater;

  return local.map((migration, index) => {
    // Drizzle compares every entry with the database's single latest
    // created_at value. Cap applied entries in the scratch journal so none can
    // be mistaken for pending even if a historical database was unusual.
    if (index < applied.length) return Math.min(migration.folderMillis, databaseHighWater);
    nextTimestamp = Math.max(migration.folderMillis, nextTimestamp + 1);
    return nextTimestamp;
  });
}

async function appliedMigrations(url: string): Promise<AppliedMigration[]> {
  const sql = neon(url);
  const relation = await sql`select to_regclass('drizzle.__drizzle_migrations') as name`;
  if (!relation[0]?.name) return [];
  return await sql`
    select id, hash, created_at::text as created_at
    from drizzle.__drizzle_migrations
    order by id
  ` as AppliedMigration[];
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL_DIRECT;
  if (!url) throw new Error("DATABASE_URL_DIRECT is required to migrate the database");

  const sourceMigrations = resolve("drizzle");
  const local = readMigrationFiles({ migrationsFolder: sourceMigrations });
  const applied = await appliedMigrations(url);
  const timestamps = databaseCompatibleMigrationTimestamps(local, applied);
  const journal = JSON.parse(
    await readFile(join(sourceMigrations, "meta", "_journal.json"), "utf8"),
  ) as Journal;
  if (journal.entries.length !== timestamps.length) {
    throw new Error("Drizzle journal entry count does not match the migration files");
  }
  journal.entries.forEach((entry, index) => {
    if (entry.idx !== index || !entry.tag.startsWith(`${index.toString().padStart(4, "0")}_`)) {
      throw new Error(`invalid Drizzle journal entry at position ${index + 1}`);
    }
    entry.when = timestamps[index] ?? entry.when;
  });

  const scratchRoot = join(homedir(), "Code");
  await mkdir(scratchRoot, { recursive: true });
  const scratch = await mkdtemp(join(scratchRoot, "swyx-drizzle-migrate-"));
  try {
    const scratchMigrations = join(scratch, "drizzle");
    const configPath = join(scratch, "drizzle.config.ts");
    await cp(sourceMigrations, scratchMigrations, { recursive: true });
    await writeFile(
      join(scratchMigrations, "meta", "_journal.json"),
      `${JSON.stringify(journal, null, 2)}\n`,
    );
    await writeFile(configPath, `export default {
  dialect: "postgresql",
  out: ${JSON.stringify(scratchMigrations)},
  dbCredentials: { url: process.env.DATABASE_URL_DIRECT ?? "" },
  strict: true,
  verbose: true,
};
`);

    const result = spawnSync(
      "pnpm",
      ["exec", "drizzle-kit", "migrate", "--config", configPath],
      { env: process.env, stdio: "inherit" },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`drizzle-kit migrate exited with status ${result.status}`);
    console.log(`migration history verified (${applied.length} applied, ${local.length - applied.length} pending)`);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && basename(process.argv[1]) === "migrate-database.ts") {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
