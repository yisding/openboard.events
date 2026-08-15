import { randomUUID } from "node:crypto";
import { Client } from "pg";

/**
 * Names every database this run creates, so teardown reclaims exactly the ones
 * it owns. A bare `openboard_test_` sweep would also match a second command
 * running against the same TEST_POSTGRES_URL and force-drop databases out from
 * under it mid-test.
 */
export const RUN_ID_VARIABLE = "OPENBOARD_TEST_RUN_ID";

/** `openboard_test_<run>_<instance>`, both halves lowercase hex. */
const TEST_DATABASE_PATTERN = /^openboard_test_[0-9a-f]+_[0-9a-f]+$/;

export function databasePrefix(runId: string) {
  return `openboard_test_${runId}_`;
}

/** Runs in the main process before any worker starts, so workers inherit it. */
export function setup() {
  process.env[RUN_ID_VARIABLE] ??= randomUUID().replaceAll("-", "");
}

/**
 * The adapter drops its database in `close()`, but a suite is free to construct
 * a client and let the run end without closing it. Against the disposable
 * container that costs nothing; against the dedicated server TEST_POSTGRES_URL
 * is documented to point at, the leftovers accumulate run after run.
 */
export async function teardown() {
  const testPostgresUrl = process.env.TEST_POSTGRES_URL;
  const runId = process.env[RUN_ID_VARIABLE];
  if (!testPostgresUrl || !runId) return;

  const admin = new Client({ connectionString: testPostgresUrl });
  await admin.connect();
  try {
    const leftovers = await admin.query<{ datname: string }>(
      "SELECT datname FROM pg_database WHERE datname LIKE $1",
      [`${databasePrefix(runId)}%`],
    );
    for (const { datname } of leftovers.rows) {
      // Re-check the shape before it reaches an identifier position: a database
      // name cannot be bound as a parameter, so it has to be interpolated.
      if (!TEST_DATABASE_PATTERN.test(datname)) continue;
      // FORCE (Postgres 13+) evicts a connection the owning suite never released.
      await admin.query(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);
    }
  } finally {
    await admin.end();
  }
}
