import { integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { events, users } from "./core";
import { confirmationStatusEnum, tokenPurposeEnum } from "./enums";

export const contacts = pgTable("contacts", {
  id: uuid("id").defaultRandom().primaryKey(), eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  email: text("email").notNull(), firstName: text("first_name").notNull().default(""), lastName: text("last_name").notNull().default(""),
  salutation: text("salutation"), honorific: text("honorific"), pronouns: text("pronouns"), gender: text("gender"), jobTitle: text("job_title"), company: text("company"), bioHtml: text("bio_html"),
  headshotFileId: uuid("headshot_file_id"), linkedinUrl: text("linkedin_url"), twitterUrl: text("twitter_url"), facebookUrl: text("facebook_url"), websiteUrl: text("website_url"),
  confirmationStatus: confirmationStatusEnum("confirmation_status").notNull().default("unconfirmed"), unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [unique().on(table.eventId, table.email), unique().on(table.id, table.eventId)]);

export const portalTokens = pgTable("portal_tokens", {
  id: uuid("id").defaultRandom().primaryKey(), eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").notNull(), purpose: tokenPurposeEnum("purpose").notNull(), tokenHash: text("token_hash").notNull().unique(), otpHash: text("otp_hash"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), attempts: integer("attempts").notNull().default(0), consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [unique().on(table.id, table.eventId)]);

export const portalSessions = pgTable("portal_sessions", {
  id: uuid("id").defaultRandom().primaryKey(), eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }), contactId: uuid("contact_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(), impersonatedByUserId: uuid("impersonated_by_user_id").references(() => users.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [unique().on(table.id, table.eventId)]);

export const adminSessions = pgTable("admin_sessions", {
  id: uuid("id").defaultRandom().primaryKey(), userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
export const apiKeys = pgTable("api_keys", {
  id: uuid("id").defaultRandom().primaryKey(), eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  name: text("name").notNull(), keyHash: text("key_hash").notNull().unique(), lastUsedAt: timestamp("last_used_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [unique().on(table.id, table.eventId)]);
