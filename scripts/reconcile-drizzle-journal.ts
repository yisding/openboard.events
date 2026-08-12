import { basename } from "node:path";
import { neon } from "@neondatabase/serverless";
import { readMigrationFiles, type MigrationMeta } from "drizzle-orm/migrator";

export type AppliedMigration = {
  id: number;
  hash: string;
  created_at: string | number;
};

export type JournalTimestampRepair = {
  id: number;
  hash: string;
  createdAt: number;
};

/**
 * Match by ordered id and content hash before proposing metadata-only repairs.
 * A divergent or unknown migration stops the deploy before any row is changed.
 */
export function journalTimestampRepairs(
  local: Pick<MigrationMeta, "hash" | "folderMillis">[],
  applied: AppliedMigration[],
): JournalTimestampRepair[] {
  if (applied.length > local.length) {
    throw new Error(`database has ${applied.length} migrations but this checkout has only ${local.length}`);
  }

  return applied.flatMap((row, index) => {
    const expected = local[index];
    if (!expected || row.hash !== expected.hash) {
      throw new Error(`migration hash mismatch at applied position ${index + 1}; refusing journal repair`);
    }
    if (Number(row.created_at) === expected.folderMillis) return [];
    return [{ id: row.id, hash: row.hash, createdAt: expected.folderMillis }];
  });
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL_DIRECT;
  if (!url) throw new Error("DATABASE_URL_DIRECT is required to reconcile the Drizzle journal");
  const sql = neon(url);
  const relation = await sql`select to_regclass('drizzle.__drizzle_migrations') as name`;
  if (!relation[0]?.name) {
    console.log("Drizzle journal does not exist yet; no timestamp reconciliation needed");
    return;
  }

  const applied = await sql`
    select id, hash, created_at::text as created_at
    from drizzle.__drizzle_migrations
    order by id
  ` as AppliedMigration[];
  const local = readMigrationFiles({ migrationsFolder: "drizzle" });
  const repairs = journalTimestampRepairs(local, applied);
  if (repairs.length === 0) {
    console.log(`Drizzle journal timestamps already match ${applied.length} applied migration(s)`);
    return;
  }

  const values = repairs.map((_repair, index) => {
    const offset = index * 3;
    return `($${offset + 1}::integer,$${offset + 2}::text,$${offset + 3}::bigint)`;
  }).join(",");
  const params = repairs.flatMap((repair) => [repair.id, repair.hash, repair.createdAt]);
  const updated = await sql.query(
    `update drizzle.__drizzle_migrations as actual
       set created_at = desired.created_at
      from (values ${values}) as desired(id, hash, created_at)
     where actual.id = desired.id and actual.hash = desired.hash
     returning actual.id`,
    params,
  );
  if (updated.length !== repairs.length) {
    throw new Error(`journal repair updated ${updated.length} row(s), expected ${repairs.length}`);
  }
  console.log(`reconciled ${repairs.length} verified Drizzle journal timestamp(s)`);
}

if (process.argv[1] && basename(process.argv[1]) === "reconcile-drizzle-journal.ts") {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
