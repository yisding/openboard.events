import { boolean, index, integer, jsonb, numeric, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { events, users } from "./core";
import { criterionKindEnum, planStatusEnum, reviewAssignmentStatusEnum } from "./enums";
import { submissions } from "./submissions";

export const evaluationPlans = pgTable("evaluation_plans", {
  id: uuid("id").defaultRandom().primaryKey(), eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  name: text("name").notNull(), round: integer("round").notNull().default(1), scaleMin: integer("scale_min").notNull().default(1), scaleMax: integer("scale_max").notNull().default(5),
  status: planStatusEnum("status").notNull().default("open"), trackIds: uuid("track_ids").array(),
  // M50: the half-open review window and blind-review switch. NULL on either
  // bound means unbounded on that side, which is what every M19 round was.
  opensAt: timestamp("opens_at", { withTimezone: true }), closesAt: timestamp("closes_at", { withTimezone: true }),
  anonymizeAuthors: boolean("anonymize_authors").notNull().default(false),
  // Independent scoring is the safe default: a reviewer should not be
  // anchored by the committee's current mean unless the organizer explicitly
  // chooses a collaborative calibration round.
  showPeerScores: boolean("show_peer_scores").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [unique().on(table.eventId, table.name), unique().on(table.id, table.eventId)]);
export const evaluationCriteria = pgTable("evaluation_criteria", {
  id: uuid("id").defaultRandom().primaryKey(), eventId: uuid("event_id").notNull(), planId: uuid("plan_id").notNull().references(() => evaluationPlans.id, { onDelete: "cascade" }),
  label: text("label").notNull(), weight: numeric("weight").notNull().default("1"), sortOrder: integer("sort_order").notNull().default(0),
  // M50 typed criteria. `numeric`/`required` reproduce M19's arithmetic, where
  // a blank criterion already withheld the weighted mean.
  kind: criterionKindEnum("kind").notNull().default("numeric"), required: boolean("required").notNull().default(true),
  options: jsonb("options").notNull().default([]), minValue: numeric("min_value"), maxValue: numeric("max_value"),
}, (table) => [unique().on(table.id, table.eventId)]);
/** Candidate routing: which tracks make a member a plausible reviewer for a round. */
export const reviewerAssignments = pgTable("reviewer_assignments", {
  id: uuid("id").defaultRandom().primaryKey(), eventId: uuid("event_id").notNull(), planId: uuid("plan_id").notNull().references(() => evaluationPlans.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }), trackIds: uuid("track_ids").array(),
}, (table) => [unique().on(table.planId, table.userId), unique().on(table.id, table.eventId)]);
/**
 * M50: the reviewer queue's authority. Track scope helps an organizer *pick*
 * candidates; this row is what a reviewer may actually open and score.
 */
export const reviewAssignments = pgTable("review_assignments", {
  id: uuid("id").defaultRandom().primaryKey(), eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  planId: uuid("plan_id").notNull().references(() => evaluationPlans.id, { onDelete: "cascade" }),
  submissionId: uuid("submission_id").notNull().references(() => submissions.id, { onDelete: "cascade" }),
  reviewerUserId: uuid("reviewer_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: reviewAssignmentStatusEnum("status").notNull().default("assigned"), recusalReason: text("recusal_reason"),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).defaultNow().notNull(), recusedAt: timestamp("recused_at", { withTimezone: true }),
  lastRemindedAt: timestamp("last_reminded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("review_assignments_natural_key").on(table.planId, table.submissionId, table.reviewerUserId),
  unique("review_assignments_id_event_key").on(table.id, table.eventId),
  index("review_assignments_reviewer_idx").on(table.eventId, table.reviewerUserId, table.planId),
  index("review_assignments_plan_idx").on(table.eventId, table.planId, table.status),
]);
export const reviews = pgTable("reviews", {
  id: uuid("id").defaultRandom().primaryKey(), eventId: uuid("event_id").notNull(), planId: uuid("plan_id").notNull().references(() => evaluationPlans.id, { onDelete: "cascade" }),
  submissionId: uuid("submission_id").notNull().references(() => submissions.id, { onDelete: "cascade" }), reviewerUserId: uuid("reviewer_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  overallScore: numeric("overall_score"), criterionScores: jsonb("criterion_scores").notNull().default({}), comment: text("comment"), isAi: boolean("is_ai").notNull().default(false),
  submittedAt: timestamp("submitted_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [unique().on(table.planId, table.submissionId, table.reviewerUserId), unique().on(table.id, table.eventId)]);

/** Immutable snapshots of every meaningful review save. */
export const reviewRevisions = pgTable("review_revisions", {
  id: uuid("id").defaultRandom().primaryKey(),
  eventId: uuid("event_id").notNull(),
  reviewId: uuid("review_id").notNull(),
  planId: uuid("plan_id").notNull(),
  submissionId: uuid("submission_id").notNull(),
  reviewerUserId: uuid("reviewer_user_id").notNull(),
  revision: integer("revision").notNull(),
  overallScore: numeric("overall_score"),
  criterionScores: jsonb("criterion_scores").notNull().default({}),
  criteriaSnapshot: jsonb("criteria_snapshot").notNull().default([]),
  isAi: boolean("is_ai").notNull().default(false),
  comment: text("comment"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique().on(table.reviewId, table.revision),
  unique().on(table.id, table.eventId),
  index("review_revisions_submission_idx").on(table.eventId, table.submissionId, table.recordedAt),
]);
