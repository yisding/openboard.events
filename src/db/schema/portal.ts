import { sql } from "drizzle-orm";
import { boolean, check, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { contacts } from "./contacts";
import { events, fileAssets, users } from "./core";
import {
  completionViaEnum,
  fileCommentAuthorRoleEnum,
  fileExportGroupByEnum,
  fileExportStatusEnum,
  taskModeEnum,
  taskTargetEnum,
} from "./enums";
import { forms } from "./forms";
import { submissions } from "./submissions";

export const fileRequests = pgTable("file_requests", {
  id: uuid("id").defaultRandom().primaryKey(), eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  title: text("title").notNull(), targetType: taskTargetEnum("target_type").notNull().default("contact"), instructionsHtml: text("instructions_html"),
  acceptedExtensions: text("accepted_extensions").array().notNull().default(["pdf", "ppt", "pptx", "key", "zip", "png", "jpg", "jpeg"]), maxSizeMb: integer("max_size_mb").notNull().default(100),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [unique().on(table.id, table.eventId)]);
export const portalTasks = pgTable("portal_tasks", {
  id: uuid("id").defaultRandom().primaryKey(), eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  name: text("name").notNull(), descriptionHtml: text("description_html").notNull().default(""), targetType: taskTargetEnum("target_type").notNull().default("contact"), completionMode: taskModeEnum("completion_mode").notNull().default("manual"),
  formId: uuid("form_id").references(() => forms.id, { onDelete: "restrict" }), fileRequestId: uuid("file_request_id").references(() => fileRequests.id, { onDelete: "restrict" }),
  dueAt: timestamp("due_at", { withTimezone: true }), isActive: boolean("is_active").notNull().default(true), sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [unique().on(table.id, table.eventId)]);
export const taskCompletions = pgTable("task_completions", {
  id: uuid("id").defaultRandom().primaryKey(), eventId: uuid("event_id").notNull(), taskId: uuid("task_id").notNull().references(() => portalTasks.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }), submissionId: uuid("submission_id").references(() => submissions.id, { onDelete: "cascade" }),
  completedVia: completionViaEnum("completed_via").notNull(), formResponseId: uuid("form_response_id"), fileUploadId: uuid("file_upload_id"),
  completedByUserId: uuid("completed_by_user_id").references(() => users.id, { onDelete: "set null" }), completedAt: timestamp("completed_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique().on(table.id, table.eventId),
  check("task_completions_evidence_ck", sql`
    (${table.completedVia} = 'form_response') = (${table.formResponseId} IS NOT NULL)
    AND (${table.completedVia} = 'file_upload') = (${table.fileUploadId} IS NOT NULL)
  `),
]);
export const formResponses = pgTable("form_responses", {
  id: uuid("id").defaultRandom().primaryKey(), eventId: uuid("event_id").notNull(), formId: uuid("form_id").notNull().references(() => forms.id, { onDelete: "cascade" }),
  formVersion: integer("form_version").notNull(), contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  submissionId: uuid("submission_id").references(() => submissions.id, { onDelete: "cascade" }), answers: jsonb("answers").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [unique().on(table.id, table.eventId)]);
export const fileUploads = pgTable("file_uploads", {
  id: uuid("id").defaultRandom().primaryKey(), eventId: uuid("event_id").notNull(), fileRequestId: uuid("file_request_id").notNull().references(() => fileRequests.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }), submissionId: uuid("submission_id").references(() => submissions.id, { onDelete: "cascade" }),
  fileAssetId: uuid("file_asset_id").notNull().references(() => fileAssets.id, { onDelete: "cascade" }), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  // M52: numbered per (fileRequestId, contactId, submissionId) slot, with
  // exactly one `isLatest` row per slot enforced by a partial unique index
  // (drizzle/0006). Set inside the same statement that inserts the row —
  // never by a client, per the module's "latest is server-derived" guardrail.
  version: integer("version").notNull().default(1),
  isLatest: boolean("is_latest").notNull().default(true),
}, (table) => [unique().on(table.id, table.eventId)]);

// M52 — plaintext comments on a file-request slot (request × contact ×
// submission), surviving a re-upload rather than pinning to one version.
export const fileComments = pgTable("file_comments", {
  id: uuid("id").defaultRandom().primaryKey(), eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  fileRequestId: uuid("file_request_id").notNull().references(() => fileRequests.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  submissionId: uuid("submission_id").references(() => submissions.id, { onDelete: "cascade" }),
  authorRole: fileCommentAuthorRoleEnum("author_role").notNull(),
  authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),
  authorContactId: uuid("author_contact_id").references(() => contacts.id, { onDelete: "set null" }),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [unique().on(table.id, table.eventId)]);

// M52 — asynchronous latest-file ZIP export jobs.
export const fileExportJobs = pgTable("file_export_jobs", {
  id: uuid("id").defaultRandom().primaryKey(), eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  requestedByUserId: uuid("requested_by_user_id").references(() => users.id, { onDelete: "set null" }),
  status: fileExportStatusEnum("status").notNull().default("pending"),
  groupBy: fileExportGroupByEnum("group_by").notNull().default("none"),
  fileUploadIds: uuid("file_upload_ids").array().notNull().default([]),
  entryCount: integer("entry_count").notNull().default(0),
  resultFileId: uuid("result_file_id").references(() => fileAssets.id, { onDelete: "set null" }),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
}, (table) => [unique().on(table.id, table.eventId)]);
export const resourcePages = pgTable("resource_pages", {
  id: uuid("id").defaultRandom().primaryKey(), eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  title: text("title").notNull(), slug: text("slug").notNull(), summary: text("summary").notNull().default(""), bodyHtml: text("body_html"), sortOrder: integer("sort_order").notNull().default(0),
  published: boolean("published").notNull().default(true), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [unique().on(table.eventId, table.slug), unique().on(table.id, table.eventId)]);
