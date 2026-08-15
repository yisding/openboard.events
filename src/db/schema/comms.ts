import { boolean, customType, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { sessions } from "./agenda";
import { contacts } from "./contacts";
import { events } from "./core";
import { commStatusEnum, icsMethodEnum, suppressionReasonEnum, templateKeyEnum } from "./enums";
import { portalTasks } from "./portal";
import { submissions } from "./submissions";

const bytea = customType<{ data: Uint8Array }>({ dataType: () => "bytea" });

export const emailTemplates = pgTable("email_templates", {
  id: uuid("id").defaultRandom().primaryKey(), eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  key: templateKeyEnum("key").notNull(), subject: text("subject").notNull(), bodyHtml: text("body_html").notNull(), enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [unique().on(table.eventId, table.key), unique().on(table.id, table.eventId)]);
export const reminderRules = pgTable("reminder_rules", {
  id: uuid("id").defaultRandom().primaryKey(), eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  offsetDays: integer("offset_days").notNull(), enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [unique().on(table.eventId, table.offsetDays), unique().on(table.id, table.eventId)]);
export const communicationLogs = pgTable("communication_logs", {
  id: uuid("id").defaultRandom().primaryKey(), eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }), templateKey: templateKeyEnum("template_key").notNull(),
  idempotencyKey: text("idempotency_key").notNull().unique(), status: commStatusEnum("status").notNull().default("queued"),
  subjectRendered: text("subject_rendered"), bodyRenderedHtml: text("body_rendered_html"), secretPayloadCiphertext: bytea("secret_payload_ciphertext"),
  error: text("error"), providerMessageId: text("provider_message_id"), icsUid: text("ics_uid"), attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).defaultNow().notNull(), lockedUntil: timestamp("locked_until", { withTimezone: true }),
  submissionId: uuid("submission_id").references(() => submissions.id, { onDelete: "set null" }), sessionId: uuid("session_id").references(() => sessions.id, { onDelete: "set null" }),
  taskId: uuid("task_id").references(() => portalTasks.id, { onDelete: "set null" }), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), sentAt: timestamp("sent_at", { withTimezone: true }),
}, (table) => [
  unique().on(table.id, table.eventId),
  index("communication_logs_contact_created_idx")
    .on(table.eventId, table.contactId, table.createdAt.desc().nullsFirst()),
]);
// P3-EMAIL: Resend bounce/complaint webhook target. Deliberately its own
// table, one row per suppressed contact, rather than columns on `contacts` —
// that table's writes go through the event-contacts feature's identity writers,
// both of which use an unqualified `.returning()`/insert (every declared
// column), so adding columns there breaks every PGlite fixture across every
// feature that creates or edits a contact and has not also loaded this
// migration. A contact's mere presence here means suppressed; there is no
// "unsuppress" today (matching `M46`'s own scope: "suppression list UI" is a
// P4 item), so no boolean/nullable-pair column is needed.
export const contactSuppressions = pgTable("contact_suppressions", {
  contactId: uuid("contact_id").primaryKey().references(() => contacts.id, { onDelete: "cascade" }),
  eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  reason: suppressionReasonEnum("reason").notNull(),
  suppressedAt: timestamp("suppressed_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("contact_suppressions_event_idx").on(table.eventId)]);
export const calendarInvites = pgTable("calendar_invites", {
  id: uuid("id").defaultRandom().primaryKey(), eventId: uuid("event_id").notNull(), contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }), icsUid: text("ics_uid").notNull().unique(), sequence: integer("sequence").notNull().default(0),
  eventSnapshot: jsonb("event_snapshot").notNull(),
  lastMethod: icsMethodEnum("last_method").notNull().default("request"), organizerEmail: text("organizer_email").notNull(), lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [unique().on(table.contactId, table.sessionId), unique().on(table.id, table.eventId)]);
export const calendarCancellationJobs = pgTable("calendar_cancellation_jobs", {
  communicationLogId: uuid("communication_log_id").primaryKey().references(() => communicationLogs.id, { onDelete: "cascade" }),
  snapshot: jsonb("snapshot").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
