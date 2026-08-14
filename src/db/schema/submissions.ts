import { sql } from "drizzle-orm";
import { boolean, foreignKey, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { contacts } from "./contacts";
import { events, sessionFormats, tags, tracks, users } from "./core";
import { participantRoleEnum, submissionKindEnum, submissionSourceEnum, submissionStatusEnum } from "./enums";
import { formFields, forms } from "./forms";

export const submissions = pgTable("submissions", {
  id: uuid("id").defaultRandom().primaryKey(), eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  formId: uuid("form_id").references(() => forms.id, { onDelete: "set null" }), formVersion: integer("form_version"), code: integer("code").notNull(),
  kind: submissionKindEnum("kind").notNull().default("abstract"), status: submissionStatusEnum("status").notNull().default("draft"), source: submissionSourceEnum("source").notNull().default("cfp"),
  title: varchar("title", { length: 255 }).notNull().default(""), descriptionHtml: text("description_html"), trackId: uuid("track_id").references(() => tracks.id, { onDelete: "set null" }),
  formatId: uuid("format_id").references(() => sessionFormats.id, { onDelete: "set null" }), level: text("level"), language: text("language"), capacity: integer("capacity"), ceuCredits: numeric("ceu_credits"),
  startsAt: timestamp("starts_at", { withTimezone: true }), endsAt: timestamp("ends_at", { withTimezone: true }), clientSessionId: text("client_session_id"),
  submitterContactId: uuid("submitter_contact_id").references(() => contacts.id, { onDelete: "set null" }), submittedAt: timestamp("submitted_at", { withTimezone: true }),
  decidedAt: timestamp("decided_at", { withTimezone: true }), notifiedAt: timestamp("notified_at", { withTimezone: true }), notifyRevision: integer("notify_revision").notNull().default(0),
  withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }), rowVersion: integer("row_version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique().on(table.eventId, table.code), unique().on(table.id, table.eventId),
  index("submissions_event_status_idx").on(table.eventId, table.status), index("submissions_event_form_idx").on(table.eventId, table.formId),
  index("submissions_event_track_idx").on(table.eventId, table.trackId), index("submissions_event_submitter_idx").on(table.eventId, table.submitterContactId),
  index("submissions_event_created_id_idx").on(table.eventId, table.createdAt, table.id),
  uniqueIndex("submissions_one_draft_per_contact_form_uq").on(table.eventId, table.formId, table.submitterContactId).where(sql`status='draft' AND form_id IS NOT NULL AND submitter_contact_id IS NOT NULL`),
]);

/**
 * A deliberately sparse mutex for the submission cap invariant. Final submits
 * lock one (event, form, submitter) row, so speakers submitting to unrelated
 * forms never queue behind each other. Rows are created lazily and disappear
 * with their owning event-scoped form/contact.
 */
export const submissionLimitGuards = pgTable("submission_limit_guards", {
  eventId: uuid("event_id").notNull(),
  formId: uuid("form_id").notNull(),
  contactId: uuid("contact_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.eventId, table.formId, table.contactId] }),
  foreignKey({ columns: [table.formId, table.eventId], foreignColumns: [forms.id, forms.eventId] }).onDelete("cascade"),
  foreignKey({ columns: [table.contactId, table.eventId], foreignColumns: [contacts.id, contacts.eventId] }).onDelete("cascade"),
]);

/** Immutable proposal-state transitions, including attributed decision reversals. */
export const submissionStatusRevisions = pgTable("submission_status_revisions", {
  id: uuid("id").defaultRandom().primaryKey(),
  eventId: uuid("event_id").notNull(),
  submissionId: uuid("submission_id").notNull(),
  fromStatus: submissionStatusEnum("from_status"),
  toStatus: submissionStatusEnum("to_status").notNull(),
  source: text("source").notNull().default("system"),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  actorContactId: uuid("actor_contact_id").references(() => contacts.id, { onDelete: "set null" }),
  changedAt: timestamp("changed_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique().on(table.id, table.eventId),
  index("submission_status_revisions_submission_idx")
    .on(table.eventId, table.submissionId, table.changedAt.desc().nullsFirst()),
  foreignKey({ columns: [table.submissionId, table.eventId], foreignColumns: [submissions.id, submissions.eventId] }).onDelete("cascade"),
]);

export const submissionParticipants = pgTable("submission_participants", {
  id: uuid("id").defaultRandom().primaryKey(), eventId: uuid("event_id").notNull(), submissionId: uuid("submission_id").notNull().references(() => submissions.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }), role: participantRoleEnum("role").notNull().default("speaker"),
  isPrimary: boolean("is_primary").notNull().default(false), sortOrder: integer("sort_order").notNull().default(0), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [unique().on(table.submissionId, table.contactId), unique().on(table.id, table.eventId), uniqueIndex("submission_primary_uq").on(table.submissionId).where(sql`is_primary`)]);

export const submissionAnswers = pgTable("submission_answers", {
  id: uuid("id").defaultRandom().primaryKey(), eventId: uuid("event_id").notNull(), submissionId: uuid("submission_id").notNull().references(() => submissions.id, { onDelete: "cascade" }),
  fieldId: uuid("field_id").notNull(), participantId: uuid("participant_id").references(() => submissionParticipants.id, { onDelete: "cascade" }),
  value: jsonb("value").notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique().on(table.id, table.eventId),
  foreignKey({ columns: [table.fieldId, table.eventId], foreignColumns: [formFields.id, formFields.eventId] }),
]);

export const submissionTags = pgTable("submission_tags", {
  eventId: uuid("event_id").notNull(), submissionId: uuid("submission_id").notNull().references(() => submissions.id, { onDelete: "cascade" }),
  tagId: uuid("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
}, (table) => [primaryKey({ columns: [table.submissionId, table.tagId] })]);
