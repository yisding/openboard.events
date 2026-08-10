import { integer, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { contacts } from "./contacts";
import { events, rooms, sessionFormats, tracks, users } from "./core";
import { participantRoleEnum, sessionStatusEnum } from "./enums";
import { submissions } from "./submissions";

export const sessions = pgTable("sessions", {
  id: uuid("id").defaultRandom().primaryKey(), eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  submissionId: uuid("submission_id").unique().references(() => submissions.id, { onDelete: "set null" }), title: text("title").notNull(), slug: text("slug").notNull(), descriptionHtml: text("description_html"),
  formatId: uuid("format_id").references(() => sessionFormats.id, { onDelete: "set null" }), trackId: uuid("track_id").references(() => tracks.id, { onDelete: "set null" }), roomId: uuid("room_id").references(() => rooms.id, { onDelete: "set null" }),
  startsAt: timestamp("starts_at", { withTimezone: true }), endsAt: timestamp("ends_at", { withTimezone: true }), status: sessionStatusEnum("status").notNull().default("draft"),
  scheduleRevision: integer("schedule_revision").notNull().default(0), rowVersion: integer("row_version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [unique().on(table.eventId, table.slug), unique().on(table.id, table.eventId)]);
export const sessionSpeakers = pgTable("session_speakers", {
  eventId: uuid("event_id").notNull(), sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }), role: participantRoleEnum("role").notNull().default("speaker"), sortOrder: integer("sort_order").notNull().default(0),
}, (table) => [primaryKey({ columns: [table.sessionId, table.contactId] })]);

// M52 — immutable title/description history. `restoredFromRevisionId`'s FK
// is added after the table exists (drizzle/0006) because it references this
// same table.
export const sessionContentRevisions = pgTable("session_content_revisions", {
  id: uuid("id").defaultRandom().primaryKey(), eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  title: text("title").notNull(), descriptionHtml: text("description_html").notNull().default(""),
  editedByUserId: uuid("edited_by_user_id").references(() => users.id, { onDelete: "set null" }), restoredFromRevisionId: uuid("restored_from_revision_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [unique().on(table.id, table.eventId)]);
