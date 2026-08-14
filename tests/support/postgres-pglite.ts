import { randomUUID } from "node:crypto";
import { Client, Pool, types as pgTypes, type PoolClient, type QueryResult } from "pg";

const testPostgresUrl = process.env.TEST_POSTGRES_URL;

if (!testPostgresUrl) {
  throw new Error("TEST_POSTGRES_URL is required for the native Postgres test adapter");
}

export const types = {
  DATE: 1082,
  TIMESTAMP: 1114,
  TIMESTAMPTZ: 1184,
  INTERVAL: 1186,
};

type QueryOptions = {
  rowMode?: "array" | "object";
  parsers?: Record<number, (value: string) => unknown>;
};

type Queryable = Pick<Pool | PoolClient, "query">;
type PgQueryConfig = {
  text: string;
  values: unknown[];
  rowMode?: "array";
  types?: {
    getTypeParser: (oid: number, format?: "text" | "binary") => (value: string) => unknown;
  };
};

function runQuery(client: Queryable, query: string | PgQueryConfig) {
  const execute = client.query.bind(client) as unknown as (
    value: string | PgQueryConfig,
  ) => Promise<QueryResult | QueryResult[]>;
  return execute(query);
}

function databaseUrl(name: string) {
  const url = new URL(testPostgresUrl as string);
  url.pathname = `/${name}`;
  return url.toString();
}

function mapResult(result: QueryResult) {
  return {
    rows: result.rows,
    affectedRows: result.rowCount ?? 0,
    fields: result.fields.map((field) => ({ name: field.name, dataTypeID: field.dataTypeID })),
  };
}

async function queryIn<T>(
  client: Queryable,
  text: string,
  params: unknown[] = [],
  options: QueryOptions = {},
) {
  const result = await runQuery(client, {
    text,
    values: params,
    ...(options.rowMode === "array" ? { rowMode: "array" as const } : {}),
    ...(options.parsers ? {
      types: {
        getTypeParser: (oid: number, format?: "text" | "binary") =>
          options.parsers?.[oid] ?? pgTypes.getTypeParser(oid, format),
      },
    } : {}),
  });
  if (Array.isArray(result)) throw new Error("A parameterized test query returned multiple results");
  return mapResult(result) as { rows: T[]; affectedRows: number; fields: Array<{ name: string; dataTypeID: number }> };
}

async function execIn(client: Queryable, text: string) {
  const result = await runQuery(client, text);
  return (Array.isArray(result) ? result : [result]).map(mapResult);
}

class PostgresTransaction {
  constructor(private readonly client: PoolClient) {}

  query<T>(text: string, params?: unknown[], options?: QueryOptions) {
    return queryIn<T>(this.client, text, params, options);
  }

  exec(text: string) {
    return execIn(this.client, text);
  }
}

/**
 * A narrow PGlite-compatible client for the test suite. Every instance owns a
 * disposable native Postgres database, preserving the isolation existing
 * tests expect while avoiding repeated WASM startup and execution costs.
 */
export class PGlite {
  readonly waitReady: Promise<void>;
  private readonly name = `openboard_test_${process.pid}_${randomUUID().replaceAll("-", "")}`;
  private pool: Pool | undefined;
  private isClosed = false;

  constructor() {
    this.waitReady = this.initialize();
  }

  get ready() {
    return this.pool !== undefined;
  }

  get closed() {
    return this.isClosed;
  }

  private async initialize() {
    const admin = new Client({ connectionString: testPostgresUrl });
    await admin.connect();
    try {
      await admin.query(`CREATE DATABASE ${this.name} TEMPLATE template0`);
    } finally {
      await admin.end();
    }
    this.pool = new Pool({ connectionString: databaseUrl(this.name), max: 4 });
  }

  private async database() {
    await this.waitReady;
    if (!this.pool || this.isClosed) throw new Error("Postgres test database is closed");
    return this.pool;
  }

  async query<T>(text: string, params?: unknown[], options?: QueryOptions) {
    return queryIn<T>(await this.database(), text, params, options);
  }

  async exec(text: string) {
    return execIn(await this.database(), text);
  }

  async transaction<T>(callback: (transaction: PostgresTransaction) => Promise<T>) {
    const client = await (await this.database()).connect();
    await client.query("BEGIN");
    try {
      const result = await callback(new PostgresTransaction(client));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async close() {
    if (this.isClosed) return;
    await this.waitReady;
    this.isClosed = true;
    await this.pool?.end();

    const admin = new Client({ connectionString: testPostgresUrl });
    await admin.connect();
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${this.name}`);
    } finally {
      await admin.end();
    }
  }
}
