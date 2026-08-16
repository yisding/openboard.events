/**
 * Server barrel for the Airtable integration.
 *
 * Note what is *not* here: `openAirtableConnectionIn`, the one function that
 * returns a plaintext personal access token. It stays behind
 * `server/connection.ts` so a route handler cannot reach it by accident — the
 * only callers are the sync engine and the two connect steps that must talk to
 * Airtable on the organizer's behalf.
 */
export * from "./schemas";
export * from "./scopes";
export * from "./plan";

export * from "./copy";

export {
  attachAirtableBaseIn,
  chooseAirtableBase,
  chooseAirtableBaseIn,
  listAirtableBases,
  updateAirtableOptions,
  validateAirtableToken,
  claimDueAirtableConnectionsIn,
  connectedEventCountIn,
  disconnectAirtable,
  disconnectAirtableIn,
  getAirtableConnection,
  getAirtableConnectionIn,
  invalidateSchemaSnapshotIn,
  listAirtableBasesIn,
  markConnectionNeedsAttentionIn,
  pruneAbandonedAirtableConnections,
  pruneAbandonedAirtableConnectionsIn,
  updateAirtableOptionsIn,
  validateAirtableTokenIn,
  type ChooseBaseInput,
  AIRTABLE_INTERVAL_MS,
} from "./server/connection";

export {
  SYNC_RUN_ERRORS,
  latestSyncRun,
  latestSyncRunIn,
  listSyncRuns,
  listSyncRunsIn,
  pruneAirtableSyncRuns,
  pruneAirtableSyncRunsIn,
  reapExpiredSyncRuns,
  reapExpiredSyncRunsIn,
  type SyncRunErrorKey,
  type SyncRunStatus,
} from "./server/runs";

export {
  AIRTABLE_EVENTS_PER_TICK,
  AIRTABLE_LEASE_MS,
  AIRTABLE_MANUAL_BUDGET_MS,
  AIRTABLE_RUN_BUDGET_MS,
  AIRTABLE_SWEEP_BUDGET_MS,
  AIRTABLE_WRITES_PER_RUN,
  runAirtableSyncForEvent,
  runAirtableSyncForEventIn,
  runDueAirtableSyncs,
  runDueAirtableSyncsIn,
  type SyncRunOutcome,
} from "./server/sync";

export { ensureBaseSchema, type EnsureSchemaResult } from "./server/schema-sync";
export {
  AirtableError,
  createAirtableClient,
  isAirtableAuthError,
  isAirtableSchemaError,
  redactAirtableError,
  type AirtableClient,
} from "./server/client";
