import { index, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

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
