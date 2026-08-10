import { Client, type QueryResultRow } from "pg";
import { TEST_DATABASE_URL } from "./env";

/**
 * Direct reads of `sb-test`, for the assertions the UI structurally cannot make.
 *
 * Two of the six specs need this: the fan-out law ("exactly one
 * `communication_logs` row per submission") and the idempotency law ("pressing
 * Notify again creates no new rows") are statements about rows, and a screen
 * that shows a decision was sent proves nothing about how many times it was.
 *
 * `pg` rather than the app's Neon driver on purpose: this is a test harness
 * talking to a database, not the application, and it must not depend on the
 * app's client behaving correctly to report that the app misbehaved. Every
 * caller is gated on `databaseConfigured()`.
 */
export async function withDatabase<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  if (!TEST_DATABASE_URL) {
    throw new Error("NEON_TEST_URL is not set — gate the step on databaseConfigured() before calling the database");
  }
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(TEST_DATABASE_URL);
  const client = new Client({
    connectionString: TEST_DATABASE_URL,
    // Neon terminates TLS with a publicly trusted certificate, so the check
    // stays on; a local Postgres has none, so it is skipped there rather than
    // globally disabled.
    ...(local ? {} : { ssl: { rejectUnauthorized: true } }),
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** One statement, one connection. Specs run with `workers: 1`, so this is cheap enough to keep simple. */
export async function queryRows<Row extends QueryResultRow>(text: string, params: readonly unknown[] = []): Promise<Row[]> {
  return withDatabase(async (client) => (await client.query<Row>(text, [...params])).rows);
}

/** `select count(*)` as a number, because every caller wants a number. */
export async function countRows(text: string, params: readonly unknown[] = []): Promise<number> {
  const rows = await queryRows<{ n: string | number }>(text, params);
  return Number(rows[0]?.n ?? 0);
}
