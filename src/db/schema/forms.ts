import { boolean, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { events, tracks, users } from "./core";
import { fieldTypeEnum, formContextEnum, formStatusEnum, reviewVisibilityEnum, submissionKindEnum, taskTargetEnum } from "./enums";

export const forms = pgTable("forms", {
  id: uuid("id").defaultRandom().primaryKey(), eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  context: formContextEnum("context").notNull(), internalName: text("internal_name").notNull(), externalTitle: text("external_title").notNull().default(""),
  pageHeading: varchar("page_heading", { length: 15 }).notNull().default("Welcome!"), status: formStatusEnum("status").notNull().default("draft"),
  kind: submissionKindEnum("kind").notNull().default("abstract"), collectParticipants: boolean("collect_participants").notNull().default(true),
  opensAt: timestamp("opens_at", { withTimezone: true }), closesAt: timestamp("closes_at", { withTimezone: true }), submissionLimit: integer("submission_limit"),
  showWelcome: boolean("show_welcome").notNull().default(true), welcomeHtml: text("welcome_html"), successHtml: text("success_html"), autoRedirectToPortal: boolean("auto_redirect_to_portal").notNull().default(true),
  participantRoles: jsonb("participant_roles").notNull().default([{ role: "speaker", enabled: true, min: 1, max: null }]),
  sendConfirmation: boolean("send_confirmation").notNull().default(true), confirmationSubject: text("confirmation_subject"), confirmationBodyHtml: text("confirmation_body_html"),
  targetType: taskTargetEnum("target_type"), currentVersion: integer("current_version").notNull().default(0), rowVersion: integer("row_version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [unique().on(table.id, table.eventId), index("forms_event_context_status_idx").on(table.eventId, table.context, table.status)]);

export const formSections = pgTable("form_sections", {
  id: uuid("id").defaultRandom().primaryKey(), eventId: uuid("event_id").notNull(), formId: uuid("form_id").notNull(), key: text("key").notNull(),
  title: text("title").notNull().default(""), pageHeading: varchar("page_heading", { length: 15 }).notNull().default(""), descriptionHtml: text("description_html"), sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [unique().on(table.formId, table.key), unique().on(table.id, table.eventId)]);

export const formFields = pgTable("form_fields", {
  id: uuid("id").defaultRandom().primaryKey(), eventId: uuid("event_id").notNull(), formId: uuid("form_id").notNull(), sectionId: uuid("section_id").notNull(),
  key: text("key").notNull(), label: text("label").notNull(), fieldType: fieldTypeEnum("field_type").notNull(), required: boolean("required").notNull().default(false),
  locked: boolean("locked").notNull().default(false), maxChars: integer("max_chars"), helpText: text("help_text"), options: jsonb("options"), visibility: jsonb("visibility"), mapsTo: text("maps_to"),
  // M50 blind review: `identity` is the fail-closed default, so an unclassified
  // question is withheld from an anonymized reviewer rather than leaked to one.
  reviewVisibility: reviewVisibilityEnum("review_visibility").notNull().default("identity"),
  sortOrder: integer("sort_order").notNull().default(0), deletedAt: timestamp("deleted_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [unique().on(table.id, table.eventId), uniqueIndex("form_fields_key_live_uq").on(table.formId, table.key).where(sql`deleted_at IS NULL`)]);

export const formVersions = pgTable("form_versions", {
  id: uuid("id").defaultRandom().primaryKey(), eventId: uuid("event_id").notNull(), formId: uuid("form_id").notNull(), version: integer("version").notNull(),
  snapshot: jsonb("snapshot").notNull(), publishedAt: timestamp("published_at", { withTimezone: true }).defaultNow().notNull(), publishedBy: uuid("published_by").references(() => users.id, { onDelete: "set null" }),
}, (table) => [unique().on(table.formId, table.version), unique().on(table.id, table.eventId)]);

export const routingRules = pgTable("routing_rules", {
  id: uuid("id").defaultRandom().primaryKey(), eventId: uuid("event_id").notNull(), formId: uuid("form_id").notNull(), sortOrder: integer("sort_order").notNull().default(0),
  match: text("match").notNull().default("all"), conditions: jsonb("conditions").notNull(), setTrackId: uuid("set_track_id").references(() => tracks.id, { onDelete: "set null" }),
  addTagIds: uuid("add_tag_ids").array().notNull().default([]), enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [unique().on(table.id, table.eventId)]);
