import { index, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./core";
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
