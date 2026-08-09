import { jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { events } from "./core";

export const airtableSyncState = pgTable("airtable_sync_state", {
  id: uuid("id").defaultRandom().primaryKey(), eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  tableName: text("table_name").notNull(), recordPk: text("record_pk").notNull(), airtableRecordId: text("airtable_record_id").notNull(), contentHash: text("content_hash").notNull(),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [unique().on(table.eventId, table.tableName, table.recordPk), unique().on(table.id, table.eventId)]);
export const airtableSyncRuns = pgTable("airtable_sync_runs", {
  id: uuid("id").defaultRandom().primaryKey(), eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  trigger: text("trigger").notNull(), status: text("status").notNull().default("running"), startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }), stats: jsonb("stats").notNull().default({}), error: text("error"),
}, (table) => [unique().on(table.id, table.eventId)]);
