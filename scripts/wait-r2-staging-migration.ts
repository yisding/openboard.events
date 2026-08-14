import { neon } from "@neondatabase/serverless";

const POLL_INTERVAL_MS = 10_000;
const MAX_POLLS = 120;
const LEGACY_PRESIGN_GRACE_MS = 15 * 60 * 1000;

type MigrationState = {
  complete: boolean;
  remaining_legacy_rows: number;
  remaining_legacy_objects: number;
  failures: number;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
};

function numeric(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

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
    last = row ? {
      complete: row.complete === true,
      remaining_legacy_rows: numeric(row.remaining_legacy_rows),
      remaining_legacy_objects: numeric(row.remaining_legacy_objects),
      failures: numeric(row.failures),
      started_at: String(row.started_at),
      updated_at: String(row.updated_at),
      completed_at: row.completed_at ? String(row.completed_at) : null,
    } : null;
    const coveredPresignWindow = last?.completed_at
      ? Date.parse(last.completed_at) - Date.parse(last.started_at) >= LEGACY_PRESIGN_GRACE_MS
      : false;
    if (last?.complete && coveredPresignWindow
      && last.remaining_legacy_rows === 0 && last.remaining_legacy_objects === 0 && last.failures === 0) {
      console.log(JSON.stringify({ verified: true, ...last }));
      return;
    }
    console.log(JSON.stringify({ verified: false, attempt, state: last }));
    if (attempt < MAX_POLLS) await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(`R2 staging migration did not reach zero inventory: ${JSON.stringify(last)}`);
}

await main();
