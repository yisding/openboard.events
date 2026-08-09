import { boolean, integer, jsonb, numeric, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { events, users } from "./core";
import { planStatusEnum } from "./enums";
import { submissions } from "./submissions";

export const evaluationPlans = pgTable("evaluation_plans", {
  id: uuid("id").defaultRandom().primaryKey(), eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  name: text("name").notNull(), round: integer("round").notNull().default(1), scaleMin: integer("scale_min").notNull().default(1), scaleMax: integer("scale_max").notNull().default(5),
  status: planStatusEnum("status").notNull().default("open"), trackIds: uuid("track_ids").array(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [unique().on(table.eventId, table.name), unique().on(table.id, table.eventId)]);
export const evaluationCriteria = pgTable("evaluation_criteria", {
  id: uuid("id").defaultRandom().primaryKey(), eventId: uuid("event_id").notNull(), planId: uuid("plan_id").notNull().references(() => evaluationPlans.id, { onDelete: "cascade" }),
  label: text("label").notNull(), weight: numeric("weight").notNull().default("1"), sortOrder: integer("sort_order").notNull().default(0),
}, (table) => [unique().on(table.id, table.eventId)]);
export const reviewerAssignments = pgTable("reviewer_assignments", {
  id: uuid("id").defaultRandom().primaryKey(), eventId: uuid("event_id").notNull(), planId: uuid("plan_id").notNull().references(() => evaluationPlans.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }), trackIds: uuid("track_ids").array(),
}, (table) => [unique().on(table.planId, table.userId), unique().on(table.id, table.eventId)]);
export const reviews = pgTable("reviews", {
  id: uuid("id").defaultRandom().primaryKey(), eventId: uuid("event_id").notNull(), planId: uuid("plan_id").notNull().references(() => evaluationPlans.id, { onDelete: "cascade" }),
  submissionId: uuid("submission_id").notNull().references(() => submissions.id, { onDelete: "cascade" }), reviewerUserId: uuid("reviewer_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  overallScore: numeric("overall_score"), criterionScores: jsonb("criterion_scores").notNull().default({}), comment: text("comment"), isAi: boolean("is_ai").notNull().default(false),
  submittedAt: timestamp("submitted_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [unique().on(table.planId, table.submissionId, table.reviewerUserId), unique().on(table.id, table.eventId)]);
