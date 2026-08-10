import { index, integer, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { events } from "./core";
import { speakerLogisticsFieldTypeEnum } from "./enums";

// M51 — standalone speaker roster operations (drizzle/0008). See that
// migration's header for why these are separate tables rather than columns
// on `contacts`.

export const speakerLogisticsFields = pgTable("speaker_logistics_fields", {
  id: uuid("id").defaultRandom().primaryKey(),
  eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  label: text("label").notNull(),
  fieldType: speakerLogisticsFieldTypeEnum("field_type").notNull().default("text"),
  options: text("options").array().notNull().default([]),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [unique().on(table.eventId, table.key), unique().on(table.id, table.eventId)]);

export const speakerLogisticsValues = pgTable("speaker_logistics_values", {
  eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  fieldId: uuid("field_id").notNull(),
  contactId: uuid("contact_id").notNull(),
  value: text("value").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.fieldId, table.contactId] }),
  index("speaker_logistics_values_contact_idx").on(table.eventId, table.contactId),
]);

export const contactUnavailability = pgTable("contact_unavailability", {
  id: uuid("id").defaultRandom().primaryKey(),
  eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique().on(table.id, table.eventId),
  index("contact_unavailability_contact_idx").on(table.eventId, table.contactId, table.startsAt),
]);

// The ad hoc per-recipient content for one `speaker_bulk_message` outbox row,
// looked up by `idempotencyKey` at render time (comms/server/context.ts).
export const speakerBulkMessages = pgTable("speaker_bulk_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  subject: text("subject").notNull(),
  bodyHtml: text("body_html").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("speaker_bulk_messages_event_idx").on(table.eventId, table.createdAt)]);
