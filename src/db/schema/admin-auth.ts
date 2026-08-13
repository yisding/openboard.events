import { sql } from "drizzle-orm";
import { check, customType, index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { users } from "./core";
import { commStatusEnum, templateKeyEnum } from "./enums";

const bytea = customType<{ data: Uint8Array }>({ dataType: () => "bytea" });

/**
 * M42 — Better Auth's `account` and `verification` models for admin/organizer
 * auth (`drizzle/0009_product_auth.sql`). The `session` model reuses the
 * pre-existing `admin_sessions` table, declared in `./contacts`.
 *
 * These are admin-only. Speaker portal auth keeps its own `portal_sessions` /
 * `portal_tokens` tables and its custom OTP/magic-link implementation — M42
 * does not move it (DECISIONS.md, "Product auth direction").
 */

/**
 * Credential and social-provider links.
 *
 * `providerId = 'credential'` rows carry the password hash — including the
 * legacy PBKDF2 strings 0009 backfilled out of `users.password_hash`, which
 * `admin-password.ts` verifies and rehashes on first sign-in.
 * `providerId = 'google'` rows carry the OAuth tokens.
 */
export const adminAccounts = pgTable("admin_accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  password: text("password"),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [unique().on(table.providerId, table.accountId)]);

/**
 * Short-lived verification values: password-reset and email-verification
 * tokens, plus the OAuth state/PKCE records written during the Google
 * round-trip.
 */
export const adminVerifications = pgTable("admin_verifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Product-level password-reset, email-verification, and organization-invite
 * delivery.
 *
 * These messages exist before an organizer has created an event, so they
 * cannot honestly live in the event/contact-scoped `communication_logs`
 * outbox. A new organization's team invitations have the same constraint:
 * they must work before the first event exists. These messages still get the
 * same durable claim/retry/idempotency posture, while each short-lived bearer
 * URL stays encrypted until dispatch.
 */
export const adminAuthEmailOutbox = pgTable("admin_auth_email_outbox", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  recipientEmail: text("recipient_email").notNull(),
  recipientName: text("recipient_name").notNull().default(""),
  templateKey: templateKeyEnum("template_key").notNull(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  status: commStatusEnum("status").notNull().default("queued"),
  subjectRendered: text("subject_rendered"),
  bodyRenderedHtml: text("body_rendered_html"),
  secretPayloadCiphertext: bytea("secret_payload_ciphertext"),
  error: text("error"),
  providerMessageId: text("provider_message_id"),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).defaultNow().notNull(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  suppressedAt: timestamp("suppressed_at", { withTimezone: true }),
}, (table) => [
  check("admin_auth_email_outbox_template_ck", sql`
    ${table.templateKey} in ('admin_password_reset', 'admin_email_verification', 'organization_invited')
  `),
  index("admin_auth_email_outbox_due_idx").on(table.status, table.nextAttemptAt, table.lockedUntil, table.createdAt),
  index("admin_auth_email_outbox_provider_idx").on(table.providerMessageId),
  index("admin_auth_email_outbox_recipient_idx").on(table.recipientEmail, table.status, table.suppressedAt),
]);

/**
 * Immutable evidence of the exact reviewed Terms and Privacy versions a user
 * accepted during self-service signup. It deliberately stores no IP address,
 * user agent, or arbitrary request metadata; the database clock, user, source,
 * and version pair are sufficient for the consent record.
 */
export const userLegalAcceptances = pgTable("user_legal_acceptances", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  termsVersion: text("terms_version").notNull(),
  privacyVersion: text("privacy_version").notNull(),
  source: text("source").notNull().default("signup"),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("user_legal_acceptances_user_versions_key").on(table.userId, table.termsVersion, table.privacyVersion),
  index("user_legal_acceptances_user_time_idx").on(table.userId, table.acceptedAt.desc()),
  check("user_legal_acceptances_terms_version_ck", sql`length(trim(${table.termsVersion})) BETWEEN 1 AND 80`),
  check("user_legal_acceptances_privacy_version_ck", sql`length(trim(${table.privacyVersion})) BETWEEN 1 AND 80`),
  check("user_legal_acceptances_source_ck", sql`${table.source} = 'signup'`),
]);
