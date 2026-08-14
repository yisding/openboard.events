import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { eventMembers, events, users } from "./core";
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
  // M59 — set once the speaker has seen the acceptance-celebration moment on
  // their portal home, so a repeat visit shows the ordinary home instead.
  acceptanceSeenAt: timestamp("acceptance_seen_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [unique().on(table.eventId, table.email), unique().on(table.id, table.eventId)]);

/**
 * Stable product-user <-> event-contact identity. The row exists only after an
 * explicit business action (backfill, invitation acceptance, reminder
 * provisioning, or operator resolution); ordinary reads never infer identity
 * from email. Both composite foreign keys keep the relationship inside one
 * event and remove it automatically with either membership or contact erasure.
 */
export const userContactLinks = pgTable("user_contact_links", {
  userId: uuid("user_id").notNull(),
  eventId: uuid("event_id").notNull(),
  contactId: uuid("contact_id").notNull(),
  source: text("source").$type<"backfill" | "invitation" | "reminder" | "operator">().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.eventId] }),
  unique("user_contact_links_event_contact_uq").on(table.eventId, table.contactId),
  foreignKey({
    columns: [table.userId, table.eventId],
    foreignColumns: [eventMembers.userId, eventMembers.eventId],
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.contactId, table.eventId],
    foreignColumns: [contacts.id, contacts.eventId],
  }).onDelete("cascade"),
  check("user_contact_links_source_ck", sql`${table.source} IN ('backfill', 'invitation', 'reminder', 'operator')`),
]);

/**
 * Immutable, PII-free report from migration 0041. `ambiguous` rows are the
 * operator quarantine: no stable link was created for them. Candidate ids can
 * be inspected against current records without preserving an email snapshot
 * after either identity is erased.
 */
export const userContactLinkBackfillAudit = pgTable("user_contact_link_backfill_audit", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  outcome: text("outcome").$type<"linked" | "unlinked" | "ambiguous">().notNull(),
  candidateContactIds: uuid("candidate_contact_ids").array().notNull().default([]),
  linkedContactId: uuid("linked_contact_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.eventId] }),
  index("user_contact_link_backfill_outcome_idx").on(table.outcome, table.eventId),
  check("user_contact_link_backfill_outcome_ck", sql`${table.outcome} IN ('linked', 'unlinked', 'ambiguous')`),
  check("user_contact_link_backfill_shape_ck", sql`
    (${table.outcome} = 'linked' AND cardinality(${table.candidateContactIds}) = 1 AND ${table.linkedContactId} = ${table.candidateContactIds}[1])
    OR (${table.outcome} = 'unlinked' AND cardinality(${table.candidateContactIds}) = 0 AND ${table.linkedContactId} IS NULL)
    OR (${table.outcome} = 'ambiguous' AND cardinality(${table.candidateContactIds}) > 1 AND ${table.linkedContactId} IS NULL)
  `),
]);
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

/**
 * Durable proof that an API-key creation committed. It deliberately does not
 * reference `api_keys`: revocation must consume the caller-owned operation id
 * forever so a delayed response retry cannot resurrect the deleted key.
 */
export const apiKeyCreationReceipts = pgTable("api_key_creation_receipts", {
  operationId: uuid("operation_id").primaryKey(),
  eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  payloadFingerprint: text("payload_fingerprint").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("api_key_creation_receipts_event_idx").on(table.eventId),
  check("api_key_creation_receipts_payload_fingerprint_ck", sql`btrim(${table.payloadFingerprint}) <> ''`),
]);
