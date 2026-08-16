import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
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

/**
 * Durable idempotency tombstone for a manual create. Deliberately has no FK to
 * `sessions`: a hard delete removes the session but must not make its caller-
 * owned primary id reusable by a delayed original POST.
 */
export const sessionCreationReceipts = pgTable("session_creation_receipts", {
  creationId: uuid("creation_id").primaryKey(),
  eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  payloadFingerprint: text("payload_fingerprint").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("session_creation_receipts_event_idx").on(table.eventId),
  check("session_creation_receipts_payload_fingerprint_ck", sql`btrim(${table.payloadFingerprint}) <> ''`),
]);

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

// MTP-07 — the placement half of that history: one row per recorded move, from
// the drag, the dialog and Auto-place alike. Room *names* are frozen on both
// sides (drizzle/0050) so renaming or deleting a room cannot rewrite the
// account of the placements it once held.
export const sessionPlacementRevisions = pgTable("session_placement_revisions", {
  id: uuid("id").defaultRandom().primaryKey(), eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  fromStartsAt: timestamp("from_starts_at", { withTimezone: true }), fromEndsAt: timestamp("from_ends_at", { withTimezone: true }), fromRoomName: text("from_room_name"),
  toStartsAt: timestamp("to_starts_at", { withTimezone: true }), toEndsAt: timestamp("to_ends_at", { withTimezone: true }), toRoomName: text("to_room_name"),
  movedByUserId: uuid("moved_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("session_placement_revisions_session_idx").on(table.sessionId, table.createdAt.desc().nullsFirst())]);
