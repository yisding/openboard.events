import { index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { events, users } from "./core";
import { organizations } from "./organizations";
import { crmActivityKindEnum, crmContactSourceEnum, crmPipelineStageEnum, speakerLogisticsFieldTypeEnum } from "./enums";

/**
 * M55 — organization-level speaker CRM (`drizzle/0013_speaker_crm.sql`).
 *
 * `organization_contacts` is a NEW, separate identity from `contacts`
 * (event-scoped) — the guardrail "CRM introduces an explicit organization
 * identity/link rather than silently collapsing event rows" means this file
 * never adds an `organization_id` column to `contacts` or a `contacts.id`
 * foreign key that would make an event contact belong to only one
 * organization identity implicitly. `organization_contact_links` is the
 * explicit many-to-one join: many event `contacts` rows (one per event) can
 * point at one `organization_contacts` row.
 *
 * Every child table below carries `organization_id` directly (not just
 * reachable by joining through `organization_contacts`) so every read in
 * `src/features/crm` can put `organization_id = $1` in its own WHERE clause
 * — the same "scope is in the query, not inferred" discipline
 * `organizations/server/queries.ts` documents — and every child also FKs
 * through the `(id, organization_id)` composite key so a row can never point
 * at a contact/tag/field in a different organization.
 */
export const organizationContacts = pgTable("organization_contacts", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  firstName: text("first_name").notNull().default(""),
  lastName: text("last_name").notNull().default(""),
  company: text("company"),
  jobTitle: text("job_title"),
  bioHtml: text("bio_html"),
  linkedinUrl: text("linkedin_url"),
  twitterUrl: text("twitter_url"),
  websiteUrl: text("website_url"),
  source: crmContactSourceEnum("source").notNull().default("manual"),
  // Admin-defined key -> value map; `organization_contact_custom_fields`
  // below is the definition/label/type catalog. See that table's comment for
  // why values are inline JSON rather than a third EAV table.
  customFields: jsonb("custom_fields").notNull().default({}),
  // Set only by `mergeOrganizationContactsIn` when this row is the losing
  // side of a merge: the row is kept (never hard-deleted, so its history and
  // the merge audit's `merged_contact_id` foreign key both survive) but
  // excluded from directory search/segments/pipeline going forward.
  mergedIntoId: uuid("merged_into_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique().on(table.organizationId, table.email),
  unique().on(table.id, table.organizationId),
  index("organization_contacts_org_idx").on(table.organizationId, table.email),
]);

/**
 * The explicit organization-identity <-> event-contact link. `UNIQUE
 * (event_id, contact_id)` is what "push a contact into an event without
 * duplicate creation" relies on: `pushOrganizationContactToEventIn` upserts
 * this row with `onConflictDoNothing`, so pushing the same organization
 * contact into the same event twice is a no-op, not a second link.
 */
export const organizationContactLinks = pgTable("organization_contact_links", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  organizationContactId: uuid("organization_contact_id").notNull(),
  eventId: uuid("event_id").notNull(),
  contactId: uuid("contact_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique().on(table.eventId, table.contactId),
  index("organization_contact_links_contact_idx").on(table.organizationContactId),
  index("organization_contact_links_org_event_idx").on(table.organizationId, table.eventId),
]);

export const organizationContactTags = pgTable("organization_contact_tags", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color").notNull().default("#00a878"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique().on(table.organizationId, table.name),
  unique().on(table.id, table.organizationId),
]);

export const organizationContactTagLinks = pgTable("organization_contact_tag_links", {
  organizationId: uuid("organization_id").notNull(),
  organizationContactId: uuid("organization_contact_id").notNull(),
  tagId: uuid("tag_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.organizationContactId, table.tagId] }),
  index("organization_contact_tag_links_tag_idx").on(table.tagId),
]);

/**
 * Field *definitions* only (key/label/type/options/order) — an
 * organization-admin-authored catalog, the same shape M51's
 * `speaker_logistics_fields` uses one scope down. Values live inline on
 * `organization_contacts.custom_fields` (a JSON object keyed by `key`, not
 * `id`, so a value survives a field being redefined) rather than a fourth
 * EAV table: unlike M51's per-event logistics values — which are read a
 * field at a time on one contact's detail page — CRM segment filters and the
 * directory list both want every contact's whole custom-field bag in one
 * query, which the JSON column gives for free without an extra join.
 */
export const organizationContactCustomFields = pgTable("organization_contact_custom_fields", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  label: text("label").notNull(),
  fieldType: speakerLogisticsFieldTypeEnum("field_type").notNull().default("text"),
  options: text("options").array().notNull().default([]),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [unique().on(table.organizationId, table.key)]);

export const organizationContactNotes = pgTable("organization_contact_notes", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  organizationContactId: uuid("organization_contact_id").notNull(),
  authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),
  bodyHtml: text("body_html").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("organization_contact_notes_contact_idx").on(table.organizationContactId, table.createdAt)]);

/**
 * Append-only activity timeline. Every mutation in `src/features/crm` writes
 * exactly one row here as its last statement (never the reason a caller's
 * request fails — activity logging is best-effort context, not a guard).
 */
export const organizationContactActivity = pgTable("organization_contact_activity", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  organizationContactId: uuid("organization_contact_id").notNull(),
  kind: crmActivityKindEnum("kind").notNull(),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("organization_contact_activity_contact_idx").on(table.organizationContactId, table.createdAt)]);

/**
 * A saved dynamic segment: `filter` is a `CrmSegmentFilter` (contracts/crm.ts),
 * resolved fresh on every read by `resolveCrmSegmentIn` — no membership rows
 * are materialized, so a field edit changes segment membership on the very
 * next resolve with nothing to invalidate.
 */
export const organizationContactSegments = pgTable("organization_contact_segments", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  filter: jsonb("filter").notNull().default({}),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [unique().on(table.organizationId, table.name)]);

/**
 * The immutable merge audit record (guardrail: "explicit primary, reference
 * counts, audit trail, and a tested recovery procedure"). `fieldSnapshot` is
 * every column `organization_contacts` carried on the losing row *before*
 * the merge overwrote nothing on it (the loser is never written to, only
 * tombstoned via `merged_into_id` — see that column's comment) — recovery is
 * therefore: clear `merged_into_id` on the loser, and reference rows can be
 * pointed back using this same snapshot plus `referenceCounts` as a checklist.
 * This table has no update/delete path anywhere in `src/features/crm`.
 */
export const organizationContactMerges = pgTable("organization_contact_merges", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  primaryContactId: uuid("primary_contact_id").notNull(),
  mergedContactId: uuid("merged_contact_id").notNull(),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  fieldSnapshot: jsonb("field_snapshot").notNull(),
  referenceCounts: jsonb("reference_counts").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("organization_contact_merges_org_idx").on(table.organizationId, table.createdAt)]);

/**
 * The sourcing kanban: one row per prospect-to-event effort. `stage` is
 * deliberately the three-state `open`/`won`/`lost` lifecycle the work order
 * names, not a wider custom-stage board. `target_event_id` has a plain
 * (non-composite) FK — see the migration's header comment for why a
 * composite `(target_event_id, organization_id)` FK is unsafe here (`ON
 * DELETE SET NULL` on a composite key would null out this row's own
 * `organization_id`, not just the event reference); the application layer
 * (`createPipelineEntryIn`) checks the target event's organization before
 * insert instead.
 */
export const organizationContactPipeline = pgTable("organization_contact_pipeline", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  organizationContactId: uuid("organization_contact_id").notNull(),
  targetEventId: uuid("target_event_id").references(() => events.id, { onDelete: "set null" }),
  stage: crmPipelineStageEnum("stage").notNull().default("open"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("organization_contact_pipeline_contact_idx").on(table.organizationContactId)]);

export const organizationContactPipelineHistory = pgTable("organization_contact_pipeline_history", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  pipelineId: uuid("pipeline_id").notNull(),
  fromStage: crmPipelineStageEnum("from_stage"),
  toStage: crmPipelineStageEnum("to_stage").notNull(),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("organization_contact_pipeline_history_pipeline_idx").on(table.pipelineId, table.createdAt)]);
