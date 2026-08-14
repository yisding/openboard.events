import { neon } from "@neondatabase/serverless";
import {
  migrationStateIsVerified,
  parseMigrationState,
  type MigrationState,
} from "./lib/r2-staging-migration-state";

const POLL_INTERVAL_MS = 10_000;
const MAX_POLLS = 120;

async function main() {
  const url = process.env.DATABASE_URL_DIRECT;
  if (!url) throw new Error("DATABASE_URL_DIRECT is required to verify the R2 staging migration");
  const sql = neon(url);
  let last: MigrationState | null = null;

  for (let attempt = 1; attempt <= MAX_POLLS; attempt += 1) {
    const rows = await sql`
      SELECT complete, remaining_legacy_rows, remaining_legacy_objects,
        failures, started_at, updated_at, completed_at
      FROM r2_staging_migration_state
      WHERE singleton
    `;
    const row = rows[0];
    last = row ? parseMigrationState(row as Record<string, unknown>) : null;
    if (last && migrationStateIsVerified(last)) {
      console.log(JSON.stringify({ verified: true, ...last }));
      return;
    }
    console.log(JSON.stringify({ verified: false, attempt, state: last }));
    if (attempt < MAX_POLLS) await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(`R2 staging migration did not reach zero inventory: ${JSON.stringify(last)}`);
}

await main();
