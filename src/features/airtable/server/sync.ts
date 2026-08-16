import { db, type DbOrTx } from "@/db/client";
import type { AirtableSyncRunId, EventId, JobStats } from "@/shared/contracts";
import { getEnv } from "@/shared/lib/env";
import { captureError } from "@/shared/lib/error-tracking";
import { AppError, isAppError } from "@/shared/lib/errors";
import { OPENBOARD_ID_FIELD, SYNC_TABLE_ORDER, type SyncTableKey } from "../plan";
import { emptySyncRunStats, type SyncRunStats, type SyncTableStats } from "../schemas";
import {
  AirtableError,
  MAX_RECORDS_PER_BATCH,
  createAirtableClient,
  redactAirtableError,
  type AirtableClient,
} from "./client";
import {
  downgradeSchemaWriteScopeIn,
  invalidateSchemaSnapshotIn,
  markConnectionNeedsAttentionIn,
  openAirtableConnectionIn,
  recordSyncOutcomeIn,
  releaseAirtableClaimsIn,
  saveSchemaSnapshotIn,
  claimDueAirtableConnectionsIn,
} from "./connection";
import {
  candidateRecordsIn,
  forgetSyncedRowsIn,
  orphanRecordsIn,
  recordSyncedRowsIn,
  syncedRowCountIn,
} from "./projection";
import {
  claimSyncRunIn,
  extendSyncRunLeaseIn,
  finishSyncRunIn,
  reapExpiredSyncRunsIn,
  updateSyncRunStatsIn,
  type SyncRunErrorKey,
} from "./runs";
import { ensureBaseSchema } from "./schema-sync";

/**
 * The engine.
 *
 * One property matters more than everything else in this file, and it is a
 * property of the *write*, not of any bookkeeping around it: every push is a
 * `performUpsert` keyed on `Openboard ID`. So —
 *
 * > Losing, corrupting, or never writing an `airtable_sync_state` row costs a
 * > redundant push. It can never cause a duplicate Airtable record.
 *
 * That is what lets this file have no adoption pass, no paging scan on connect,
 * and no torn-write recovery path: connecting onto a base that already holds
 * our rows simply updates them. `airtable_sync_state` keeps only two jobs —
 * skipping provably-unchanged rows, and holding the record ids a purge needs.
 *
 * Everything else here is about staying inside a budget honestly. Work is
 * bounded by writes, by wall clock, and by a lease; whatever a run does not
 * reach is *counted and named*, because "300 synced, 118 to go" reads as
 * competence and a silent truncation reads as a bug.
 */

/** Events claimed per cron tick. Processed sequentially — see `runDueAirtableSyncsIn`. */
export const AIRTABLE_EVENTS_PER_TICK = 5;
/** 300 records is 30 batches: ~6.6s of request spacing plus latency, inside the run budget. */
export const AIRTABLE_WRITES_PER_RUN = 300;
export const AIRTABLE_RUN_BUDGET_MS = 20_000;
export const AIRTABLE_MANUAL_BUDGET_MS = 15_000;
export const AIRTABLE_SWEEP_BUDGET_MS = 60_000;
export const AIRTABLE_LEASE_MS = 600_000;
/** Backoff after a 429 we chose not to sleep through. */
const RATE_LIMIT_RESUME_MS = 120_000;
/** Rows fetched per candidate query. Small enough to stay inside memory, big enough to amortize. */
const CANDIDATE_PAGE_SIZE = 50;
/** Purges above `max(10, 20%)` of a table are held for a human to confirm. */
const PURGE_BREAKER_FLOOR = 10;
const PURGE_BREAKER_RATIO = 0.2;

export type SyncRunOutcome = {
  runId: AirtableSyncRunId;
  status: "success" | "failed" | "blocked";
  stats: SyncRunStats;
  errorKey?: SyncRunErrorKey;
};

export type RunSyncOptions = {
  trigger: "manual" | "cron";
  budgetMs?: number;
  writeCap?: number;
  now?: () => number;
  makeClient?: (pat: string, budgetRemainingMs: () => number) => AirtableClient;
};

function emptyTableStats(key: SyncTableKey): SyncTableStats {
  return { key, created: 0, updated: 0, unchanged: 0, deleted: 0, orphans: 0, purgeHeld: 0, deferred: 0 };
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function rollUp(stats: SyncRunStats): SyncRunStats {
  const totals = stats.perTable.reduce((accumulator, table) => ({
    created: accumulator.created + table.created,
    updated: accumulator.updated + table.updated,
    unchanged: accumulator.unchanged + table.unchanged,
    deleted: accumulator.deleted + table.deleted,
    orphans: accumulator.orphans + table.orphans,
    purgeHeld: accumulator.purgeHeld + table.purgeHeld,
    deferred: accumulator.deferred + table.deferred,
  }), { created: 0, updated: 0, unchanged: 0, deleted: 0, orphans: 0, purgeHeld: 0, deferred: 0 });
  return { ...stats, ...totals, tables: stats.perTable.length };
}

/**
 * `blocked` versus `failed` is the difference between an amber card the
 * organizer can act on and a page for whoever is on call. A missing scope, a
 * retyped field, a base we can no longer see: all the customer's configuration,
 * none of them our bug.
 */
function classifyError(error: unknown): { status: "failed" | "blocked"; errorKey: SyncRunErrorKey; capture: boolean } {
  if (error instanceof AirtableError) {
    switch (error.kind) {
      case "unauthorized":
        return { status: "blocked", errorKey: "unauthorized", capture: false };
      case "forbidden":
        return { status: "blocked", errorKey: "missing_scope", capture: false };
      case "not_found":
        return { status: "blocked", errorKey: "base_missing", capture: false };
      case "schema":
        return { status: "blocked", errorKey: "schema_drifted", capture: false };
      // A duplicated merge key or a value the column won't take is the
      // organizer's row to fix, and no amount of retrying fixes it. Routed
      // through `request`/`internal` it paged an operator every fifteen minutes
      // for a record someone duplicated in their own base with Cmd-D.
      case "data_rejected":
        return { status: "blocked", errorKey: "records_rejected", capture: false };
      case "rate_limited":
        return { status: "failed", errorKey: "rate_limited", capture: false };
      case "server":
      case "network":
        return { status: "failed", errorKey: "airtable_unavailable", capture: false };
      default:
        return { status: "failed", errorKey: "internal", capture: true };
    }
  }
  if (isAppError(error) && error.code === "VALIDATION") {
    // The sealed envelope would not open — a rotated `SESSION_SECRET` or a row
    // whose ciphertext no longer matches its id. Reconnecting fixes it.
    return { status: "blocked", errorKey: "token_unreadable", capture: false };
  }
  return { status: "failed", errorKey: "internal", capture: true };
}

export async function runAirtableSyncForEventIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  options: RunSyncOptions,
): Promise<SyncRunOutcome> {
  const now = options.now ?? (() => Date.now());
  const budgetMs = options.budgetMs ?? (options.trigger === "manual" ? AIRTABLE_MANUAL_BUDGET_MS : AIRTABLE_RUN_BUDGET_MS);
  const writeCap = options.writeCap ?? AIRTABLE_WRITES_PER_RUN;
  const startedAt = now();
  const remainingMs = () => Math.max(0, budgetMs - (now() - startedAt));

  await reapExpiredSyncRunsIn(dbOrTx, eventId);
  const runId = await claimSyncRunIn(dbOrTx, eventId, options.trigger, AIRTABLE_LEASE_MS);

  let stats: SyncRunStats = emptySyncRunStats();
  let writesUsed = 0;
  let client: AirtableClient | null = null;

  const persist = async () => {
    stats = rollUp({ ...stats, apiCalls: client?.callCount ?? 0, rateLimited: client?.rateLimitedCount ?? 0 });
    await updateSyncRunStatsIn(dbOrTx, eventId, runId, stats);
  };

  try {
    const connection = await openAirtableConnectionIn(dbOrTx, eventId);
    if (!connection) throw new AppError("NOT_FOUND", "Connect an Airtable account first");
    const baseId = connection.baseId;
    if (!baseId) {
      await finishSyncRunIn(dbOrTx, eventId, runId, { status: "blocked", stats, errorKey: "base_missing" });
      await recordSyncOutcomeIn(dbOrTx, eventId, { ok: false, errorKey: "base_missing" });
      return { runId, status: "blocked", stats, errorKey: "base_missing" };
    }

    client = options.makeClient
      ? options.makeClient(connection.pat, remainingMs)
      : createAirtableClient(connection.pat, { budgetRemainingMs: remainingMs });
    const airtable: AirtableClient = client;

    const canManageSchema = connection.scopes.includes("schema.bases:write");
    let ensured = await ensureBaseSchema(airtable, {
      baseId,
      canManageSchema,
      cached: { snapshot: connection.schemaSnapshot, fingerprint: connection.schemaFingerprint },
    });
    if (!ensured.ok) {
      await invalidateSchemaSnapshotIn(dbOrTx, eventId);
      // Airtable refused a create: the `schema.bases:write` this token was
      // optimistically credited with does not exist. Writing that down is what
      // flips the panel from a "Rebuild it" button that can only 403 again to
      // the copyable field list a read-only token needs.
      if (ensured.schemaWriteDenied) await downgradeSchemaWriteScopeIn(dbOrTx, eventId);
      const errorKey: SyncRunErrorKey = ensured.reason === "missing_scope" ? "missing_scope" : "schema_drifted";
      await persist();
      await finishSyncRunIn(dbOrTx, eventId, runId, { status: "blocked", stats, errorKey });
      await recordSyncOutcomeIn(dbOrTx, eventId, { ok: false, errorKey });
      return { runId, status: "blocked", stats, errorKey };
    }
    await saveSchemaSnapshotIn(dbOrTx, eventId, ensured.snapshot, ensured.fingerprint);

    let reEnsured = false;
    let stoppedEarly = false;
    let rateLimitedOut = false;
    const completed = new Set<SyncTableKey>();

    for (const key of SYNC_TABLE_ORDER) {
      const table = emptyTableStats(key);
      stats = { ...stats, perTable: [...stats.perTable, table] };
      const target = ensured.ok ? ensured.snapshot.tables[key] : undefined;
      if (!target) continue;
      // The id is read per attempt rather than captured once: the re-ensure
      // below can move this table (an organizer who deleted or renamed
      // "Sessions" gets a freshly-created one with a new id), and a retry
      // against the id the cached snapshot carried would fail the same way —
      // or, worse, write into the table they renamed.
      let targetId = target.id;

      const pushPage = async (): Promise<"done" | "deferred" | "stopped"> => {
        for (;;) {
          const pageLimit = Math.min(CANDIDATE_PAGE_SIZE, writeCap - writesUsed);
          if (pageLimit <= 0) return "deferred";
          const { rows, total } = await candidateRecordsIn(dbOrTx, eventId, key, connection.options, pageLimit);
          if (rows.length === 0) return "done";

          for (const batch of chunk(rows, MAX_RECORDS_PER_BATCH)) {
            const result = await airtable.upsertRecords(
              baseId,
              targetId,
              batch.map((row) => ({ fields: row.fields })),
              [OPENBOARD_ID_FIELD],
            );
            const created = new Set(result.createdRecords ?? []);
            // Airtable returns records in request order, which is what lets a
            // returned record id be paired back to the row that produced it.
            const landed = batch.map((row, index) => {
              const record = result.records[index];
              return record ? { recordPk: row.recordPk, airtableRecordId: record.id, contentHash: row.contentHash } : null;
            }).filter((entry): entry is { recordPk: string; airtableRecordId: string; contentHash: string } => entry !== null);
            await recordSyncedRowsIn(dbOrTx, eventId, key, landed);
            for (const entry of landed) {
              if (created.has(entry.airtableRecordId)) table.created += 1;
              else table.updated += 1;
            }
            writesUsed += batch.length;
            if (remainingMs() <= 0 || writesUsed >= writeCap) {
              table.deferred = Math.max(0, total - rows.length);
              return "stopped";
            }
          }

          if (total <= rows.length) return "done";
          if (remainingMs() <= 0 || writesUsed >= writeCap) {
            table.deferred = Math.max(0, total - rows.length);
            return "stopped";
          }
        }
      };

      let verdict: "done" | "deferred" | "stopped";
      try {
        verdict = await pushPage();
      } catch (error) {
        // An organizer renaming a field in Airtable self-heals in one run: drop
        // the cached snapshot, re-ensure, and retry this table exactly once.
        if (error instanceof AirtableError && error.kind === "schema" && !reEnsured) {
          reEnsured = true;
          await invalidateSchemaSnapshotIn(dbOrTx, eventId);
          ensured = await ensureBaseSchema(airtable, { baseId, canManageSchema });
          if (!ensured.ok) {
            if (ensured.schemaWriteDenied) await downgradeSchemaWriteScopeIn(dbOrTx, eventId);
            throw error;
          }
          await saveSchemaSnapshotIn(dbOrTx, eventId, ensured.snapshot, ensured.fingerprint);
          const retarget = ensured.snapshot.tables[key];
          if (!retarget) throw error;
          targetId = retarget.id;
          verdict = await pushPage();
        } else if (error instanceof AirtableError && error.kind === "rate_limited") {
          rateLimitedOut = true;
          verdict = "stopped";
        } else {
          throw error;
        }
      }
      // Orphans are counted on every run whether or not the organizer has asked
      // us to remove them: the number is the honest one either way, and the
      // status card offers the button rather than assuming the answer.
      const stateTotal = await syncedRowCountIn(dbOrTx, eventId, key);
      const orphans = await orphanRecordsIn(dbOrTx, eventId, key, MAX_RECORDS_PER_BATCH * 5);
      table.orphans = orphans.orphanTotal;
      if (connection.options.pruneRemoved && orphans.orphanTotal > 0) {
        const ceiling = Math.max(PURGE_BREAKER_FLOOR, Math.floor(stateTotal * PURGE_BREAKER_RATIO));
        if (orphans.orphanTotal > ceiling) {
          // A wrong number on a status card is recoverable. A mass delete in a
          // base we do not own is not.
          table.purgeHeld = orphans.orphanTotal;
        } else {
          for (const batch of chunk(orphans.rows, MAX_RECORDS_PER_BATCH)) {
            await airtable.deleteRecords(baseId, targetId, batch.map((row) => row.airtableRecordId));
            await forgetSyncedRowsIn(dbOrTx, eventId, key, batch.map((row) => row.recordPk));
            table.deleted += batch.length;
            // The next run's orphan query re-derives the truth, so a partial
            // delete costs one more pass rather than a wrong count forever.
          }
        }
      }

      table.unchanged = Math.max(0, stateTotal - table.orphans - table.created - table.updated);
      await persist();
      await extendSyncRunLeaseIn(dbOrTx, eventId, runId, AIRTABLE_LEASE_MS);

      if (verdict === "done" && !rateLimitedOut) completed.add(key);
      if (verdict !== "done" || rateLimitedOut || remainingMs() <= 0 || writesUsed >= writeCap) {
        stoppedEarly = true;
        break;
      }
    }

    // Name the remainder, all of it. A run that stopped after Sessions still
    // knows how many Proposals it never looked at, and "300 synced, 118 to go"
    // is the sentence that makes bounded work read as competence rather than
    // as truncation. One cheap count per unreached table buys that.
    if (stoppedEarly) {
      for (const key of SYNC_TABLE_ORDER) {
        if (completed.has(key)) continue;
        const { total } = await candidateRecordsIn(dbOrTx, eventId, key, connection.options, 1);
        const entry = stats.perTable.find((candidate) => candidate.key === key);
        if (entry) entry.deferred = total;
        else stats.perTable = [...stats.perTable, { ...emptyTableStats(key), deferred: total }];
      }
    }

    await persist();
    await finishSyncRunIn(dbOrTx, eventId, runId, { status: "success", stats });
    await recordSyncOutcomeIn(dbOrTx, eventId, {
      ok: true,
      // A run that stopped inside its budget asks to be picked up immediately;
      // a 429 asks for two minutes of quiet first.
      ...(rateLimitedOut
        ? { retryAfterMs: RATE_LIMIT_RESUME_MS }
        : { resumeImmediately: stoppedEarly && stats.deferred > 0 }),
    });
    return { runId, status: "success", stats };
  } catch (error) {
    const { status, errorKey, capture } = classifyError(error);
    if (capture) {
      captureError(new Error(redactAirtableError(error)), { requestId: `job:airtable:${runId}`, feature: "airtable", code: "sync", eventId });
    }
    if (error instanceof AirtableError && error.kind === "unauthorized") {
      await markConnectionNeedsAttentionIn(dbOrTx, eventId, errorKey);
    }
    stats = rollUp({ ...stats, apiCalls: client?.callCount ?? 0, rateLimited: client?.rateLimitedCount ?? 0 });
    await finishSyncRunIn(dbOrTx, eventId, runId, { status, stats, errorKey });
    await recordSyncOutcomeIn(dbOrTx, eventId, {
      ok: false,
      errorKey,
      ...(errorKey === "rate_limited" ? { retryAfterMs: RATE_LIMIT_RESUME_MS } : {}),
    });
    return { runId, status, stats, errorKey };
  }
}

export const runAirtableSyncForEvent = (eventId: EventId, options: RunSyncOptions) =>
  runAirtableSyncForEventIn(db, eventId, options);

/**
 * The scheduled sweep's kill switch, read one layer below the dispatcher's.
 *
 * `workers/jobs/dispatch.ts` already declines to dispatch `airtable` when the
 * flag is off — deliberately, so no heartbeat is written and the health
 * endpoint reports the integration as never having run rather than as fresh.
 * This check is defense in depth for the one path that bypasses the
 * dispatcher: a hand-curled private route. It must never push customer data
 * with the flag off.
 *
 * Typed as a widened string on purpose: the zod field is `"0"` today and
 * `"0" | "1"` once the cron wiring lands, and this predicate is correct under
 * both.
 */
function scheduledSyncEnabled(override?: string): boolean {
  const flag: string = override ?? getEnv().AIRTABLE_CRON;
  return flag === "1";
}

export type SweepOptions = {
  limit?: number;
  sweepBudgetMs?: number;
  now?: () => number;
  cronFlag?: string;
  makeClient?: (pat: string, budgetRemainingMs: () => number) => AirtableClient;
};

/**
 * One cron tick: claim a bounded set of due connections and sync them
 * **sequentially**.
 *
 * Sequential rather than concurrent on purpose. N events at once would multiply
 * outbound request rate against a shared Cloudflare egress and a shared CPU
 * budget, to buy latency that a fifteen-minute cadence cannot perceive.
 */
export async function runDueAirtableSyncsIn(dbOrTx: DbOrTx, options: SweepOptions = {}): Promise<JobStats> {
  if (!scheduledSyncEnabled(options.cronFlag)) return { airtableSkippedDisabled: 1 };

  const now = options.now ?? (() => Date.now());
  const startedAt = now();
  const sweepBudgetMs = options.sweepBudgetMs ?? AIRTABLE_SWEEP_BUDGET_MS;
  const reaped = await reapExpiredSyncRunsIn(dbOrTx);
  const { eventIds, deferred } = await claimDueAirtableConnectionsIn(dbOrTx, options.limit ?? AIRTABLE_EVENTS_PER_TICK);

  const stats = {
    airtableEvents: 0,
    airtableDeferredEvents: deferred,
    airtableCreated: 0,
    airtableUpdated: 0,
    airtableUnchanged: 0,
    airtableDeleted: 0,
    airtableOrphans: 0,
    airtablePurgeHeld: 0,
    airtableBlocked: 0,
    airtableFailed: 0,
    airtableDeferredRecords: 0,
    airtableApiCalls: 0,
    airtableRateLimited: 0,
    airtableSkippedLocked: 0,
    airtableReapedRuns: reaped,
  };

  for (const [index, eventId] of eventIds.entries()) {
    if (now() - startedAt >= sweepBudgetMs) {
      const unreached = eventIds.slice(index);
      stats.airtableDeferredEvents += unreached.length;
      // The claim pushed these out a full interval before any work started.
      // Nothing was attempted for them, so hand the claim back: "deferred" has
      // to mean the next tick, not fifteen minutes from now on a sweep that had
      // capacity a minute later.
      await releaseAirtableClaimsIn(dbOrTx, unreached);
      break;
    }
    try {
      const remainingSweepMs = sweepBudgetMs - (now() - startedAt);
      const outcome = await runAirtableSyncForEventIn(dbOrTx, eventId, {
        trigger: "cron",
        budgetMs: Math.min(AIRTABLE_RUN_BUDGET_MS, remainingSweepMs),
        ...(options.now ? { now: options.now } : {}),
        ...(options.makeClient ? { makeClient: options.makeClient } : {}),
      });
      stats.airtableEvents += 1;
      stats.airtableCreated += outcome.stats.created;
      stats.airtableUpdated += outcome.stats.updated;
      stats.airtableUnchanged += outcome.stats.unchanged;
      stats.airtableDeleted += outcome.stats.deleted;
      stats.airtableOrphans += outcome.stats.orphans;
      stats.airtablePurgeHeld += outcome.stats.purgeHeld;
      stats.airtableDeferredRecords += outcome.stats.deferred;
      stats.airtableApiCalls += outcome.stats.apiCalls;
      stats.airtableRateLimited += outcome.stats.rateLimited;
      if (outcome.status === "blocked") stats.airtableBlocked += 1;
      if (outcome.status === "failed") stats.airtableFailed += 1;
    } catch (error) {
      // The partial unique index refused a second live run for this event —
      // a manual "Sync now" got there first. Not a failure, just a skip.
      if (isAppError(error) && error.code === "CONFLICT") {
        stats.airtableSkippedLocked += 1;
        continue;
      }
      stats.airtableFailed += 1;
      captureError(new Error(redactAirtableError(error)), { requestId: "job:airtable", feature: "airtable", code: "sweep", eventId });
    }
  }

  return stats;
}

export const runDueAirtableSyncs = (options?: SweepOptions) => runDueAirtableSyncsIn(db, options);
