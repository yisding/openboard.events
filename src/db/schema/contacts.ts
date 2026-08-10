import { integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { events, users } from "./core";
import { confirmationStatusEnum, speakerWorkflowStatusEnum, tokenPurposeEnum } from "./enums";

export const contacts = pgTable("contacts", {
  id: uuid("id").defaultRandom().primaryKey(), eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  email: text("email").notNull(), firstName: text("first_name").notNull().default(""), lastName: text("last_name").notNull().default(""),
  salutation: text("salutation"), honorific: text("honorific"), pronouns: text("pronouns"), gender: text("gender"), jobTitle: text("job_title"), company: text("company"), bioHtml: text("bio_html"),
  headshotFileId: uuid("headshot_file_id"), linkedinUrl: text("linkedin_url"), twitterUrl: text("twitter_url"), facebookUrl: text("facebook_url"), websiteUrl: text("website_url"),
  confirmationStatus: confirmationStatusEnum("confirmation_status").notNull().default("unconfirmed"), unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
  // M51 — organizer pipeline bookkeeping, distinct from `confirmationStatus`
  // (drizzle/0008's header comment; never gates publication or notification).
  workflowStatus: speakerWorkflowStatusEnum("workflow_status").notNull().default("new"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [unique().on(table.eventId, table.email), unique().on(table.id, table.eventId)]);
// P3-EMAIL: provider-driven suppression (Resend bounce/complaint webhook) —
// see src/db/schema/comms.ts's `contactSuppressions` for why this is its own
// table rather than columns on `contacts` (blast radius on every PGlite
// fixture that inserts/updates a contact via the shared helpers' unqualified
// `.returning()`, which every feature touching speakers goes through).

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

/**
 * M42 — the revocable admin session store, extended by `drizzle/0009_product_auth.sql`.
 *
 * Created in 0000_init.sql and left unwritten while admin auth ran on the
 * stateless jose fallback. Better Auth now owns it: `token` is the session
 * token it looks rows up by, `tokenHash` is the never-populated original
 * column (nullable since 0009). Deleting a row revokes the session.
 * Isolated from `portalSessions` above — speaker auth does not move in M42.
 */
export const adminSessions = pgTable("admin_sessions", {
  id: uuid("id").defaultRandom().primaryKey(), userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").unique(), token: text("token").unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"), userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
export const apiKeys = pgTable("api_keys", {
  id: uuid("id").defaultRandom().primaryKey(), eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  name: text("name").notNull(), keyHash: text("key_hash").notNull().unique(), lastUsedAt: timestamp("last_used_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [unique().on(table.id, table.eventId)]);
