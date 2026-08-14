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
 * Runtime transactions are confined to requestPortalLogin, the organizer's
 * single-speaker portal-invite route, createSubmission, upsertDraft,
 * updateSubmissionFromCfp, notifyQueues (PLAN's
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
 * the same way an erasure does. CRM bulk send is also transactional so one
 * campaign-wide advisory lock can serialize an original handler with a retry
 * that outlives a lost browser response; its message/outbox fan-out commits
 * or rolls back as one campaign chunk. Bulk schedule publication
 * (`bulkSetPublished` in `src/features/agenda/server/mutations.ts`) likewise
 * commits every selected session and its speaker outbox rows together, so a
 * later enqueue failure cannot leave a partially notified publication batch.
 * Form PATCH authoring (`updateFormWithPostCommitSignalsIn` in the internal
 * form route) runs its CAS bump, public availability change, immutable
 * snapshot, and current-version pointer transactionally before attempting its
 * best-effort onboarding signal outside that transaction. Every builder route
 * that produces an immutable form snapshot (section, field create/update/delete,
 * reorder, and Participant-step Save) likewise keeps its CAS, child authoring
 * rows, snapshot, and current-version pointer in one transaction.
 * Organization invitation enqueue is also transactional: token rotation,
 * stale-message retirement, the replacement outbox row, and its audit record
 * must commit together (`src/features/organizations/server/invitations.ts`).
 * Organization membership role changes and removals likewise keep the access
 * mutation and its audit evidence atomic
 * (`src/features/organizations/server/membership.ts`).
 * Evaluation plan saves, reviewer-set replacements, and explicit-queue
 * replacements also use a transaction: they acquire the plan-row lock in one
 * statement, then run the snapshot-dependent graph change in a fresh statement
 * so concurrent writers cannot leak stale reviewer or queue rows into the final
 * set or survive a narrowing round scope.
 * The single-speaker portal invite likewise commits its token rotation,
 * credential-bearing outbox row, and organizer pipeline status together; a
 * failed status write must not make an already-queued invitation look unsent.
 * CRM sourcing-pipeline creation likewise commits the new prospect row and
 * its initial open-stage history together before attempting best-effort
 * activity (`createCrmPipelineEntryWithPostCommitActivityIn`). Pipeline stage
 * transitions also lock the prospect and commit its stage, timestamped
 * history, and organizer-visible activity together (`transitionCrmPipelineIn`),
 * so a failed audit insert can never leave the board ahead of its history.
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
