import { sql } from "drizzle-orm";
import { boolean, customType, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { events, users } from "./core";

const bytea = customType<{ data: Uint8Array }>({ dataType: () => "bytea" });

/** Per-connection export gates. Defaults are mirrored by the SQL column default. */
export type AirtableConnectionOptions = {
  includeEmail: boolean;
  includeBio: boolean;
  includePronouns: boolean;
  includeGender: boolean;
  /** Speaker headshots, pushed into the People table's `Headshot` attachment column. */
  includeHeadshots: boolean;
  pruneRemoved: boolean;
};

/** Cached `GET /v0/meta/bases/{baseId}/tables` shape, keyed by our stable table key. */
export type AirtableSchemaSnapshot = {
  tables: Record<string, { id: string; fields: Record<string, string> }>;
};

/**
 * M39 — one Airtable connection per event, owned by the organizer.
 *
 * The personal access token is the customer's, not ours: it is sealed at rest
 * under `SESSION_SECRET` with its own HKDF context and AAD-bound to
 * `(eventId, connectionId)`, so a ciphertext lifted onto another event's row
 * cannot be opened. Nothing here is ever selected into a response body except
 * `token_hint` (last four characters) — see `AirtableConnectionSummary`.
 */
export const airtableConnections = pgTable("airtable_connections", {
  id: uuid("id").defaultRandom().primaryKey(),
  eventId: uuid("event_id").notNull().unique().references(() => events.id, { onDelete: "cascade" }),
  // `pending` is a token that has passed whoami but has no base yet — the
  // abandoned-wizard state the cleanup sweep reclaims after 24 hours.
  status: text("status").$type<"pending" | "connected" | "needs_attention">().notNull().default("pending"),
  tokenCiphertext: bytea("token_ciphertext").notNull(),
  tokenHint: text("token_hint").notNull(),
  // sha256 hex of the PAT: answers "is this the same token again?" without a
  // decryption, for reconnect detection and support triage.
  tokenFingerprint: text("token_fingerprint").notNull(),
  airtableUserId: text("airtable_user_id").notNull(),
  accountEmail: text("account_email"),
  scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
  baseId: text("base_id"),
  baseName: text("base_name"),
  syncEnabled: boolean("sync_enabled").notNull().default(true),
  options: jsonb("options").$type<AirtableConnectionOptions>().notNull().default({
    includeEmail: true, includeBio: true, includePronouns: false, includeGender: false,
    includeHeadshots: true, pruneRemoved: false,
  }),
  schemaSnapshot: jsonb("schema_snapshot").$type<AirtableSchemaSnapshot>(),
  schemaFingerprint: text("schema_fingerprint"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  nextSyncAfter: timestamp("next_sync_after", { withTimezone: true }).defaultNow().notNull(),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  lastErrorKey: text("last_error_key"),
  connectedByUserId: uuid("connected_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique().on(table.id, table.eventId),
  index("airtable_connections_due_idx").on(table.status, table.nextSyncAfter),
]);

export const airtableSyncState = pgTable("airtable_sync_state", {
  id: uuid("id").defaultRandom().primaryKey(), eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  tableName: text("table_name").notNull(), recordPk: text("record_pk").notNull(), airtableRecordId: text("airtable_record_id").notNull(), contentHash: text("content_hash").notNull(),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [unique().on(table.eventId, table.tableName, table.recordPk), unique().on(table.id, table.eventId)]);

export const airtableSyncRuns = pgTable("airtable_sync_runs", {
  id: uuid("id").defaultRandom().primaryKey(), eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  trigger: text("trigger").$type<"manual" | "cron">().notNull(),
  // `blocked` is deliberately not `failed`: a missing scope or a hand-retyped
  // field is the organizer's to fix and must not spend the operator's error
  // budget, but it is also not a success and must not read as one.
  status: text("status").$type<"running" | "success" | "failed" | "blocked">().notNull().default("running"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }), stats: jsonb("stats").notNull().default({}), error: text("error"),
  // Crashed isolates leave `running` rows behind; the lease is what lets the
  // next tick reap one instead of waiting for a timeout that never fires.
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
}, (table) => [
  unique().on(table.id, table.eventId),
  uniqueIndex("airtable_sync_runs_one_active_idx").on(table.eventId).where(sql`status = 'running'::text`),
  index("airtable_sync_runs_event_started_idx").on(table.eventId, table.startedAt.desc().nullsFirst()),
]);
