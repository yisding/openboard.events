import { index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { events, users } from "./core";
import { organizations } from "./organizations";

/**
 * Durable checkpoints for self-serve event setup (`drizzle/0021`). The
 * composite event/organization foreign key is declared in SQL, where the
 * `events(id, organization_id)` key introduced by 0010 lives; keeping the
 * Drizzle shape dependency-only avoids recreating that applied constraint.
 */
export const eventOnboardingProgress = pgTable("event_onboarding_progress", {
  eventId: uuid("event_id").primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  formId: uuid("form_id"),
  step: text("step").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("event_onboarding_progress_org_updated_idx").on(table.organizationId, table.updatedAt)]);

/**
 * First-occurrence product signals for the self-service funnel
 * (`drizzle/0023`). The constrained milestone name is mirrored by
 * `features/product-signals`; this table intentionally has no free-form
 * metadata or request fingerprinting fields.
 */
export const organizationOnboardingMilestones = pgTable("organization_onboarding_milestones", {
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  milestone: text("milestone").notNull(),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.organizationId, table.milestone] }),
  index("organization_onboarding_milestones_funnel_idx").on(table.milestone, table.occurredAt),
]);

/**
 * First Fair — the demo event's provisioning cursor and its guided-tour cursor,
 * in one row (`drizzle/0044`). They share a primary key, a lifecycle, the
 * composite event/organization foreign key and both readers, so splitting them
 * would double the migration and allowlist ceremony for no isolation benefit.
 *
 * Deliberately *not* `event_onboarding_progress`: that row drives the setup
 * wizard's redirects, and a tutorial that wrote one would strand the organizer
 * in setup. The composite key, like 0021's, is declared in SQL only.
 *
 * `provisionPhase` and `tourState` are constrained in SQL
 * (`event_demo_tour_phase_ck` / `event_demo_tour_state_ck`); the TypeScript
 * unions that mirror them live in `features/onboarding`.
 */
export const eventDemoTour = pgTable("event_demo_tour", {
  eventId: uuid("event_id").primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  datasetVersion: integer("dataset_version").notNull().default(1),
  provisionPhase: text("provision_phase").notNull().default("event"),
  /**
   * Where a *skipped* provision stopped (`drizzle/0045`). Null on every world
   * that finished, which is nearly all of them. `provision_phase` is the
   * cursor and "Continue without it" moves it to `ready`; without this column
   * that move erased the one fact the tour needs to mark the chapters whose
   * payload never landed as unavailable rather than pointing at an empty page.
   */
  skippedAtPhase: text("skipped_at_phase"),
  tourState: text("tour_state").notNull().default("not_started"),
  chapter: text("chapter").notNull().default("cold-open"),
  stepId: text("step_id").notNull().default("coldopen.hello"),
  armedStepId: text("armed_step_id"),
  /** The world snapshot taken when the armed objective armed — persisted, not
   * held in memory, so a reload cannot silently re-baseline a step in flight. */
  armedBaseline: jsonb("armed_baseline").$type<Record<string, unknown>>(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("event_demo_tour_org_idx").on(table.organizationId, table.updatedAt.desc().nullsFirst())]);

/**
 * First Fair — the append-only achievement log (`drizzle/0044`). One row per
 * objective the player completed or deliberately skipped, written
 * `ON CONFLICT DO NOTHING`: append-only makes recording idempotent with no
 * compare-and-set, and gives the curtain call and the persistent quest log
 * something to count.
 */
export const eventTourSteps = pgTable("event_tour_steps", {
  eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  stepId: text("step_id").notNull(),
  outcome: text("outcome").notNull().default("completed"),
  completedAt: timestamp("completed_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [primaryKey({ columns: [table.eventId, table.stepId] })]);
