import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
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
  step: text("step").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("event_onboarding_progress_org_updated_idx").on(table.organizationId, table.updatedAt)]);
