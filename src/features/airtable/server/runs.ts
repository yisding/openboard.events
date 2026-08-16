import { sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { isUniqueViolation } from "@/db/errors";
import { airtableSyncRunIdSchema, type AirtableSyncRunId, type EventId } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { emptySyncRunStats, syncRunStatsSchema, type SyncRunStats, type SyncRunSummary } from "../schemas";

/**
 * Run lifecycle for the Airtable sweep.
 *
 * `airtable_sync_runs.error` is rendered in the settings panel, so it is a
 * **closed set of user-safe sentences**, never an exception message. Real
 * messages and stacks go to `captureError` and nowhere else. This is what stops
 * an Airtable error body — or, one careless template literal from now, a
 * token — reaching a page an organizer looks at.
 */
export const SYNC_RUN_ERRORS = {
  unauthorized: "Airtable stopped accepting your token. Paste a new one and we'll resume from where we stopped.",
  missing_scope: "This token can't do everything the sync needs. Check the permissions list and add what's missing.",
  schema_drifted: "Some tables or fields in your base don't match what we expect. The list below says exactly which.",
  base_missing: "We can't see that base any more. It may have been deleted, or the token may have lost access to it.",
  records_rejected: "Airtable wouldn't accept some of these records. That's usually two rows in your base sharing one hidden Openboard ID, or a value a column's type won't take. Fix it there and the next sync carries them over.",
  rate_limited: "Airtable asked us to slow down. We stopped cleanly and will pick up where we left off.",
  airtable_unavailable: "Airtable didn't answer. Nothing was lost — the next sync carries on from here.",
  token_unreadable: "We couldn't read the stored token. Reconnect and we'll take it from there.",
  disconnected: "This event was disconnected from Airtable before the run started, so nothing was written.",
  interrupted: "This run stopped before it finished. Nothing was duplicated — the next one picks up where it left off.",
  internal: "Something on our side stopped this sync. We've been told, and the next run will try again.",
} as const;

export type SyncRunErrorKey = keyof typeof SYNC_RUN_ERRORS;

export type SyncRunStatus = "running" | "success" | "failed" | "blocked";

type RunRow = {
  id: string;
  trigger: "manual" | "cron";
  status: SyncRunStatus;
  started_at: string | Date;
  finished_at: string | Date | null;
  stats: unknown;
  error: string | null;
};

function asIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function parseStats(value: unknown): SyncRunStats {
  const parsed = syncRunStatsSchema.safeParse(value);
  return parsed.success ? parsed.data : emptySyncRunStats();
}

function toSummary(row: RunRow): SyncRunSummary {
  return {
    id: airtableSyncRunIdSchema.parse(row.id),
    trigger: row.trigger,
    status: row.status,
    startedAt: asIso(row.started_at),
    finishedAt: row.finished_at ? asIso(row.finished_at) : null,
    stats: parseStats(row.stats),
    error: row.error,
  };
}

const RUN_COLUMNS = sql`id, trigger, status, started_at, finished_at, stats, error`;

/**
 * A crashed isolate leaves a `running` row that no timeout will ever clear, so
 * the lease is what makes the next tick able to proceed. Reaped to `failed`
 * with `interrupted` rather than silently deleted: an organizer who watched a
 * sync stop deserves to see that it stopped.
 */
export async function reapExpiredSyncRunsIn(dbOrTx: DbOrTx, eventId?: EventId): Promise<number> {
  const scope = eventId ? sql` AND event_id = ${eventId}` : sql``;
  const result = await dbOrTx.execute<{ id: string }>(sql`
    UPDATE airtable_sync_runs
    SET status = 'failed', finished_at = now(), error = ${SYNC_RUN_ERRORS.interrupted}, lease_expires_at = NULL
    WHERE status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at < now()${scope}
    RETURNING id
  `);
  return (result.rows ?? []).length;
}

export const reapExpiredSyncRuns = (eventId?: EventId) => reapExpiredSyncRunsIn(db, eventId);

/**
 * Claim the one live run for this event.
 *
 * `airtable_sync_runs_one_active_idx` decides the race, not a check-then-act:
 * the loser gets 23505 and is reported as skipped. A manual "Sync now" racing a
 * cron tick therefore cannot produce two runs pushing the same records.
 */
export async function claimSyncRunIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  trigger: "manual" | "cron",
  leaseMs: number,
): Promise<AirtableSyncRunId> {
  try {
    const result = await dbOrTx.execute<{ id: string }>(sql`
      INSERT INTO airtable_sync_runs (event_id, trigger, status, stats, lease_expires_at)
      VALUES (${eventId}, ${trigger}, 'running', ${JSON.stringify(emptySyncRunStats())}::jsonb,
              now() + make_interval(secs => ${Math.round(leaseMs / 1000)}))
      RETURNING id
    `);
    const row = (result.rows ?? [])[0];
    if (!row) throw new AppError("INTERNAL", "The sync run could not be started");
    return airtableSyncRunIdSchema.parse(row.id);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError("CONFLICT", "Airtable is already running a sync for this event. Give it a few seconds.");
    }
    throw error;
  }
}

/** Held open while work is happening, so a long run is never mistaken for a dead one. */
export async function extendSyncRunLeaseIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  runId: AirtableSyncRunId,
  leaseMs: number,
): Promise<void> {
  await dbOrTx.execute(sql`
    UPDATE airtable_sync_runs
    SET lease_expires_at = now() + make_interval(secs => ${Math.round(leaseMs / 1000)})
    WHERE id = ${runId} AND event_id = ${eventId} AND status = 'running'
  `);
}

/**
 * Written after every table rather than once at the end. Seven extra single-row
 * updates per run is a rounding error against thirty Airtable requests, and it
 * is the whole reason the connect wizard's live checklist shows real numbers
 * instead of an animation.
 */
export async function updateSyncRunStatsIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  runId: AirtableSyncRunId,
  stats: SyncRunStats,
): Promise<void> {
  await dbOrTx.execute(sql`
    UPDATE airtable_sync_runs SET stats = ${JSON.stringify(stats)}::jsonb
    WHERE id = ${runId} AND event_id = ${eventId}
  `);
}

export async function finishSyncRunIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  runId: AirtableSyncRunId,
  outcome: { status: Exclude<SyncRunStatus, "running">; stats: SyncRunStats; errorKey?: SyncRunErrorKey },
): Promise<void> {
  const message = outcome.errorKey ? SYNC_RUN_ERRORS[outcome.errorKey] : null;
  await dbOrTx.execute(sql`
    UPDATE airtable_sync_runs
    SET status = ${outcome.status}, finished_at = now(), lease_expires_at = NULL,
        stats = ${JSON.stringify(outcome.stats)}::jsonb, error = ${message}
    WHERE id = ${runId} AND event_id = ${eventId}
  `);
}

export async function latestSyncRunIn(dbOrTx: DbOrTx, eventId: EventId): Promise<SyncRunSummary | null> {
  const result = await dbOrTx.execute<RunRow>(sql`
    SELECT ${RUN_COLUMNS} FROM airtable_sync_runs WHERE event_id = ${eventId}
    ORDER BY started_at DESC LIMIT 1
  `);
  const row = (result.rows ?? [])[0];
  return row ? toSummary(row) : null;
}

export const latestSyncRun = (eventId: EventId) => latestSyncRunIn(db, eventId);

export async function listSyncRunsIn(dbOrTx: DbOrTx, eventId: EventId, limit = 10): Promise<SyncRunSummary[]> {
  const result = await dbOrTx.execute<RunRow>(sql`
    SELECT ${RUN_COLUMNS} FROM airtable_sync_runs WHERE event_id = ${eventId}
    ORDER BY started_at DESC LIMIT ${limit}
  `);
  return (result.rows ?? []).map(toSummary);
}

export const listSyncRuns = (eventId: EventId, limit?: number) => listSyncRunsIn(db, eventId, limit);

/** Run history is diagnostics, not a ledger; thirty days is plenty to answer "what happened". */
export async function pruneAirtableSyncRunsIn(dbOrTx: DbOrTx): Promise<{ deleted: number }> {
  const result = await dbOrTx.execute<{ id: string }>(sql`
    DELETE FROM airtable_sync_runs
    WHERE finished_at IS NOT NULL AND finished_at < now() - interval '30 days'
    RETURNING id
  `);
  return { deleted: (result.rows ?? []).length };
}

export const pruneAirtableSyncRuns = () => pruneAirtableSyncRunsIn(db);
