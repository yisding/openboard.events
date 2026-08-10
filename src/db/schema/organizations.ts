import { index, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./core";
import { memberRoleEnum } from "./enums";

/**
 * M43 — organization tenancy (`drizzle/0010_organization_tenancy.sql`).
 *
 * The layer above events. `events.organization_id` (declared in `./core`, so
 * this module and `core` do not import each other) pins every event to exactly
 * one organization, and `events`' new `UNIQUE (id, organization_id)` lets an
 * organization-scoped table pin an event with a composite foreign key the same
 * way every event-scoped table already pins its children.
 *
 * Membership here is NOT event access. `requireAdmin(eventId, role?)` still
 * reads `event_members` and nothing else; `requireOrganizationAdmin` reads this
 * table. Two membership tables, two guards, one role ladder.
 */
export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Reuses `member_role` — the same `owner > organizer > reviewer` ladder
 * `event_members` uses, so `roleSatisfies` is literally the same function on
 * both scopes and the two can never rank a role differently.
 */
export const organizationMembers = pgTable("organization_members", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  role: memberRoleEnum("role").notNull().default("organizer"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.organizationId] }),
  index("organization_members_organization_idx").on(table.organizationId),
]);

/**
 * M44 — pending team invitations (`drizzle/0011_user_management.sql`). An
 * invitation may outlive the account it is for: `acceptedUserId` is only
 * filled in once someone with a matching email actually accepts, either by
 * signing up fresh (the Better Auth `databaseHooks.user.create.after` hook in
 * `features/auth/server/better-auth.ts`) or by accepting while already signed
 * in as a member of some other organization
 * (`features/organizations/server/invitations.ts`).
 */
export const organizationInvitations = pgTable("organization_invitations", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: memberRoleEnum("role").notNull().default("organizer"),
  tokenHash: text("token_hash").notNull().unique(),
  invitedByUserId: uuid("invited_by_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  acceptedUserId: uuid("accepted_user_id").references(() => users.id, { onDelete: "set null" }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (table) => [index("organization_invitations_org_idx").on(table.organizationId, table.createdAt)]);

/**
 * M44 — append-only audit trail over organization membership actions. Both
 * actor and target lose their reference on a deleted user (`ON DELETE SET
 * NULL`) rather than the row disappearing — history must survive the person
 * it is about.
 */
export const organizationAuditLog = pgTable("organization_audit_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  targetUserId: uuid("target_user_id").references(() => users.id, { onDelete: "set null" }),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("organization_audit_log_org_created_idx").on(table.organizationId, table.createdAt)]);
