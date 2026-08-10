import { bigint, integer, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { fileKindEnum, memberRoleEnum } from "./enums";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull().default(""),
  passwordHash: text("password_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const events = pgTable("events", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  eventType: text("event_type").notNull().default("conference"),
  websiteUrl: text("website_url"),
  location: text("location"),
  // P3-EMAIL / CAN-SPAM: the postal address every commercial email must carry.
  // Nullable — an event that has not set one yet does not block on this
  // migration; the layout footer simply omits the line until it is set.
  physicalAddress: text("physical_address"),
  timezone: text("timezone").notNull().default("America/Los_Angeles"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  theme: text("theme"),
  logoFileId: uuid("logo_file_id"),
  backgroundFileId: uuid("background_file_id"),
  submissionCapPerUser: integer("submission_cap_per_user").notNull().default(3),
  submissionSeq: integer("submission_seq").notNull().default(0),
  rowVersion: integer("row_version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const eventMembers = pgTable("event_members", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  role: memberRoleEnum("role").notNull().default("organizer"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.eventId] })]);

export const adminLoginAttempts = pgTable("admin_login_attempts", {
  keyHash: text("key_hash").primaryKey(),
  attempts: integer("attempts").notNull().default(1),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).defaultNow().notNull(),
  blockedUntil: timestamp("blocked_until", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Generic fixed-window rate-limit counter (drizzle/0005_rate_limits.sql).
// One row per hashed caller-supplied key, upserted with the same CASE-based
// single-statement pattern as adminLoginAttempts above; used by
// `@/shared/server/rate-limit` for the public submit path and `/api/v1`.
export const rateLimitBuckets = pgTable("rate_limit_buckets", {
  keyHash: text("key_hash").primaryKey(),
  count: integer("count").notNull().default(1),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const fileAssets = pgTable("file_assets", {
  id: uuid("id").defaultRandom().primaryKey(),
  eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  kind: fileKindEnum("kind").notNull().default("upload"),
  r2Key: text("r2_key").notNull().unique(),
  filename: text("filename").notNull(),
  mime: text("mime").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
  uploadedByUserId: uuid("uploaded_by_user_id").references(() => users.id, { onDelete: "set null" }),
  uploadedByContactId: uuid("uploaded_by_contact_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [unique().on(table.id, table.eventId)]);

export const tracks = pgTable("tracks", {
  id: uuid("id").defaultRandom().primaryKey(), eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  name: text("name").notNull(), color: text("color").notNull().default("#00a878"), description: text("description"), sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [unique().on(table.eventId, table.name), unique().on(table.id, table.eventId)]);
export const rooms = pgTable("rooms", {
  id: uuid("id").defaultRandom().primaryKey(), eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  name: text("name").notNull(), capacity: integer("capacity"), sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [unique().on(table.eventId, table.name), unique().on(table.id, table.eventId)]);
export const sessionFormats = pgTable("session_formats", {
  id: uuid("id").defaultRandom().primaryKey(), eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  name: text("name").notNull(), defaultDurationMins: integer("default_duration_mins").notNull().default(30), sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [unique().on(table.eventId, table.name), unique().on(table.id, table.eventId)]);
export const tags = pgTable("tags", {
  id: uuid("id").defaultRandom().primaryKey(), eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  name: text("name").notNull(), color: text("color").notNull().default("#00a878"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [unique().on(table.eventId, table.name), unique().on(table.id, table.eventId)]);
