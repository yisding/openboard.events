import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Minute buckets for unexpected runtime failures. Raw error text never lands
 * here: Cloudflare Workers Logs owns diagnostics, while this low-cardinality
 * table owns alertable counts and seven-day trend history.
 */
export const operationalErrorBuckets = pgTable("operational_error_buckets", {
  fingerprint: text("fingerprint").notNull(),
  feature: text("feature").notNull(),
  code: text("code").notNull(),
  bucketStartedAt: timestamp("bucket_started_at", { withTimezone: true }).notNull(),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
  occurrences: integer("occurrences").notNull().default(1),
}, (table) => [
  primaryKey({ columns: [table.fingerprint, table.feature, table.code, table.bucketStartedAt] }),
  index("operational_error_buckets_last_seen_idx").on(table.lastSeenAt),
]);

/** Last successful completion of each authenticated scheduled web job. */
export const scheduledJobHeartbeats = pgTable("scheduled_job_heartbeats", {
  jobName: text("job_name").primaryKey(),
  lastSucceededAt: timestamp("last_succeeded_at", { withTimezone: true }).notNull(),
  lastDurationMs: integer("last_duration_ms").notNull(),
}, (table) => [
  check("scheduled_job_heartbeats_job_name_ck", sql`
    ${table.jobName} in ('outbox', 'reminders', 'airtable', 'cleanup', 'r2-migration')
  `),
  check("scheduled_job_heartbeats_duration_ck", sql`${table.lastDurationMs} >= 0`),
]);

/**
 * Rollback tombstone. Current code never queries or writes this completed
 * checkpoint, but retained Worker versions still do. Keep the physical and
 * modeled table so a code-only rollback remains safe.
 */
export const r2StagingMigrationState = pgTable("r2_staging_migration_state", {
  singleton: boolean("singleton").primaryKey().default(true),
  rowCursor: text("row_cursor"),
  cursor: text("cursor"),
  cycleRemainingObjects: integer("cycle_remaining_objects").notNull().default(0),
  remainingLegacyRows: integer("remaining_legacy_rows").notNull().default(0),
  remainingLegacyObjects: integer("remaining_legacy_objects").notNull().default(0),
  failures: integer("failures").notNull().default(0),
  complete: boolean("complete").notNull().default(false),
  rowVersion: integer("row_version").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  check("r2_staging_migration_state_singleton_ck", sql`${table.singleton}`),
  check("r2_staging_migration_state_counts_ck", sql`
    ${table.cycleRemainingObjects} >= 0
    AND ${table.remainingLegacyRows} >= 0
    AND ${table.remainingLegacyObjects} >= 0
    AND ${table.failures} >= 0
    AND ${table.rowVersion} >= 0
  `),
]);
