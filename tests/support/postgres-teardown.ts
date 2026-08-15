import { Client } from "pg";

/**
 * Every native-adapter instance owns a disposable database that `close()`
 * drops, but a suite is free to construct one and let the run end without
 * closing it. Against the disposable container that costs nothing; against the
 * dedicated server TEST_POSTGRES_URL is documented to point at, the leftovers
 * would accumulate run after run. Sweep the prefix once the run is over rather
 * than depending on every present and future caller to close.
 */
export async function teardown() {
  const testPostgresUrl = process.env.TEST_POSTGRES_URL;
  if (!testPostgresUrl) return;

  const admin = new Client({ connectionString: testPostgresUrl });
  await admin.connect();
  try {
    const leftovers = await admin.query<{ datname: string }>(
      "SELECT datname FROM pg_database WHERE datname LIKE 'openboard\\_test\\_%'",
    );
    for (const { datname } of leftovers.rows) {
      // FORCE (Postgres 13+) evicts a connection the owning suite never released.
      await admin.query(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);
    }
  } finally {
    await admin.end();
  }
}
