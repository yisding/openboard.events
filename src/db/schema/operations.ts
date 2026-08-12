import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

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
    ${table.jobName} in ('outbox', 'reminders', 'airtable', 'cleanup')
  `),
  check("scheduled_job_heartbeats_duration_ck", sql`${table.lastDurationMs} >= 0`),
]);
