import { z } from "zod";
import {
  criterionIdSchema,
  criterionKindSchema,
  criterionValueSchema,
  planIdSchema,
  planStatusSchema,
  selectOptionSchema,
  submissionIdSchema,
  trackIdSchema,
  userIdSchema,
  type CriterionId,
  type CriterionKind,
  type CriterionValues,
  type PlanId,
  type PlanStatus,
  type ReviewAssignmentStatus,
  type ReviewWindow,
  type SelectOption,
  type SubmissionId,
  type TrackId,
  type UserId,
} from "@/shared/contracts";

/**
 * What a scoring round is, as an organizer fills it in. `trackIds: null` means
 * "every track" — the UI's empty multi-select normalizes to it, because an empty
 * array would otherwise mean "no track at all" and route nothing to anybody.
 *
 * M50 adds the round's governance: a half-open `[opensAt, closesAt)` window, a
 * blind-review switch, and criteria that are typed rather than assumed numeric.
 */
const criterionInputSchema = z.object({
  id: criterionIdSchema.nullable().default(null),
  label: z.string().trim().min(1).max(120),
  weight: z.number().positive().max(100).default(1),
  kind: criterionKindSchema.default("numeric"),
  required: z.boolean().default(true),
  options: z.array(selectOptionSchema).max(20).default([]),
  minValue: z.number().nullable().default(null),
  maxValue: z.number().nullable().default(null),
});

const planFields = z.object({
  planId: planIdSchema.nullable().default(null),
  name: z.string().trim().min(1).max(120),
  round: z.int().min(1).max(99).default(1),
  scaleMin: z.int().min(0).max(99).default(1),
  scaleMax: z.int().min(1).max(100).default(5),
  status: planStatusSchema.default("open"),
  trackIds: z.array(trackIdSchema).nullable().default(null),
  opensAt: z.iso.datetime().nullable().default(null),
  closesAt: z.iso.datetime().nullable().default(null),
  anonymizeAuthors: z.boolean().default(false),
  showPeerScores: z.boolean().default(false),
  criteria: z.array(criterionInputSchema).max(12).default([]),
});

const scaleIsOrdered = {
  check: (plan: { scaleMin: number; scaleMax: number }) => plan.scaleMax > plan.scaleMin,
  message: "The top of the scale has to be above the bottom",
  path: ["scaleMax"] as const,
};

/**
 * The window is validated here as well as by a table constraint: an organizer
 * typing the dates in the wrong order deserves a field error, not a 500 from
 * Postgres.
 */
const windowIsOrdered = {
  check: (plan: { opensAt: string | null; closesAt: string | null }) =>
    plan.opensAt === null || plan.closesAt === null || new Date(plan.closesAt) > new Date(plan.opensAt),
  message: "The round has to close after it opens",
  path: ["closesAt"] as const,
};

function refinePlan<Schema extends z.ZodType<{ scaleMin: number; scaleMax: number; opensAt: string | null; closesAt: string | null }>>(schema: Schema) {
  return schema
    .refine(scaleIsOrdered.check, { message: scaleIsOrdered.message, path: [...scaleIsOrdered.path] })
    .refine(windowIsOrdered.check, { message: windowIsOrdered.message, path: [...windowIsOrdered.path] });
}

export const planInputSchema = refinePlan(planFields);
export type PlanInput = z.infer<typeof planInputSchema>;
// Creation requires the caller's stable id. Replaying a POST after an
// ambiguous transport failure then targets the same upsert instead of creating
// a second round (or colliding on its name).
export const planCreateInputSchema = refinePlan(planFields.extend({ planId: planIdSchema }));
export type PlanCreateInput = z.infer<typeof planCreateInputSchema>;
export type CriterionInput = z.infer<typeof criterionInputSchema>;

/**
 * The same round, edited. `expectedUpdatedAt` is the caller's copy of the row's
 * timestamp: sending it turns a concurrent edit into a conflict the organizer
 * can see instead of an overwrite they cannot.
 */
export const planUpdateSchema = refinePlan(planFields.extend({ expectedUpdatedAt: z.iso.datetime().optional() }));
export type PlanUpdate = z.infer<typeof planUpdateSchema>;

export const reviewerAssignmentSchema = z.object({
  userId: userIdSchema,
  trackIds: z.array(trackIdSchema).nullable().default(null),
});
export type ReviewerAssignmentInput = z.infer<typeof reviewerAssignmentSchema>;

/**
 * Explicit assignment of work. `mode: "replace"` makes the named reviewers'
 * queues exactly the named submissions — the honest way to *un*-assign — while
 * `"add"` extends them. Recusals are never resurrected by either: a reviewer
 * who stepped back stays stepped back until an organizer says otherwise.
 */
export const assignmentInputSchema = z.object({
  planId: planIdSchema,
  reviewerUserIds: z.array(userIdSchema).min(1).max(50),
  submissionIds: z.array(submissionIdSchema).max(500),
  mode: z.enum(["add", "replace"]).default("add"),
});
export type AssignmentInput = z.infer<typeof assignmentInputSchema>;

export const recusalInputSchema = z.object({
  planId: planIdSchema,
  submissionId: submissionIdSchema,
  reviewerUserId: userIdSchema.optional(),
  reason: z.string().trim().min(1).max(500),
});
export type RecusalInput = z.infer<typeof recusalInputSchema>;

/**
 * One reviewer's verdict. Every value is optional: a review saved with a
 * comment and a blank criterion is legal, stays "in progress", and simply keeps
 * out of the average until it is finished.
 *
 * `criterionScores` accepts M19's bare numbers as well as M50's discriminated
 * values, because a client that has not reloaded is not a client that should
 * lose a reviewer's afternoon; the server normalizes both to one shape.
 */
export const reviewInputSchema = z.object({
  planId: planIdSchema,
  submissionId: submissionIdSchema,
  overallScore: z.number().nullable().default(null),
  criterionScores: z.record(criterionIdSchema, z.union([z.number(), criterionValueSchema])).default({}),
  comment: z.string().trim().max(2000).nullable().default(null),
});
export type ReviewInput = z.infer<typeof reviewInputSchema>;

export type CriterionDTO = {
  id: CriterionId;
  label: string;
  weight: number;
  sortOrder: number;
  kind: CriterionKind;
  required: boolean;
  options: SelectOption[];
  minValue: number | null;
  maxValue: number | null;
};

/**
 * Per-reviewer progress. `assigned` counts live assignments, `completed` counts
 * the ones whose review carries a `submitted_at`, and `recused` stays visible
 * rather than silently shrinking the denominator — a round where two people
 * stepped back is a different round from one where nobody did.
 */
export type ReviewerProgress = {
  userId: UserId;
  name: string;
  email: string;
  trackIds: TrackId[] | null;
  assigned: number;
  completed: number;
  recused: number;
  outstanding: number;
  /** Retained from M19 so existing callers keep reading the same number. */
  scored: number;
};

export type PlanDTO = {
  id: PlanId;
  name: string;
  round: number;
  scaleMin: number;
  scaleMax: number;
  status: PlanStatus;
  trackIds: TrackId[] | null;
  opensAt: string | null;
  closesAt: string | null;
  anonymizeAuthors: boolean;
  /** Whether reviewers may see the live committee mean while scoring. */
  showPeerScores: boolean;
  criteria: CriterionDTO[];
  reviewers: ReviewerProgress[];
  /** Plan-level progress: submissions with a finished review, over the round's own scope. */
  progress: { scored: number; total: number };
  updatedAt: string;
};

export type ReviewQueueRow = {
  submissionId: SubmissionId;
  code: number;
  title: string;
  trackId: TrackId | null;
  trackName: string | null;
  myScore: number | null;
  /** M19's shape, kept for the Rating preview; the typed values are below. */
  myCriterionScores: Record<string, number>;
  myCriterionValues: CriterionValues;
  myComment: string | null;
  scoredAt: string | null;
  avgRating: number | null;
  /** Null means the round keeps committee aggregates organizer-only. */
  nScores: number | null;
  assignmentStatus: ReviewAssignmentStatus;
  recusalReason: string | null;
};

export type ReviewQueueDTO = {
  plan: PlanDTO | null;
  rows: ReviewQueueRow[];
  progress: { scored: number; total: number };
  window: ReviewWindow | null;
};

/** What the organizer's assignment picker chooses between. */
export type AssignableSubmission = {
  submissionId: SubmissionId;
  code: number;
  title: string;
  trackId: TrackId | null;
  trackName: string | null;
  assignedTo: UserId[];
};
