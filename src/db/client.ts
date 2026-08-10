import { Pool, neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { drizzle as drizzleWs } from "drizzle-orm/neon-serverless";
import { AppError } from "@/shared/lib/errors";
import { getEnv } from "@/shared/lib/env";
import * as schema from "./schema";

function databaseUrl(): string {
  const value = getEnv().DATABASE_URL;
  if (!value) throw new AppError("INTERNAL", "DATABASE_URL is required");
  return value;
}

function createHttpDb() {
  return drizzle(neon(databaseUrl()), { schema });
}

type HttpDb = ReturnType<typeof createHttpDb>;
let cachedHttpDb: HttpDb | undefined;

function getHttpDb(): HttpDb {
  cachedHttpDb ??= createHttpDb();
  return cachedHttpDb;
}

// Defer environment parsing and client construction until the first query so
// credential-free typecheck/build jobs can import repository modules safely.
export const db = new Proxy({} as HttpDb, {
  get(_target, property) {
    const target = getHttpDb();
    const value = Reflect.get(target, property, target);
    return typeof value === "function" ? value.bind(target) : value;
  },
});

function createWsDb(pool: Pool) {
  return drizzleWs(pool, { schema });
}

type WsDb = ReturnType<typeof createWsDb>;
export type TxDb = Parameters<Parameters<WsDb["transaction"]>[0]>[0];
export type DbOrTx = typeof db | TxDb;

/**
 * Runtime transactions are confined to requestPortalLogin, createSubmission,
 * upsertDraft, updateSubmissionFromCfp, notifyQueues (PLAN's
 * "notifyDecisions" — its withTx body),
 * completeTaskViaResponse, completeTaskViaUpload, and moveSession —
 * plus, added in the M47 (data lifecycle & GDPR) run, eraseContactData
 * (`src/features/data-lifecycle/server/contact-erasure.ts`): a
 * right-to-erasure deletion spans roughly a dozen tables and must be
 * all-or-nothing, the same atomicity argument that put the original eight
 * on this list — and, added in the M55 (organization-level speaker CRM) run,
 * mergeOrganizationContactsIn (`src/features/crm/server/merge.ts`): a
 * duplicate-contact merge reassigns references across five tables and then
 * tombstones the losing identity, which must commit or roll back together
 * the same way an erasure does.
 * The command-line seed orchestrator is the sole non-runtime exception.
 */
export async function withTx<T>(work: (tx: TxDb) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: databaseUrl() });
  try {
    return await createWsDb(pool).transaction(work);
  } finally {
    await pool.end();
  }
}
