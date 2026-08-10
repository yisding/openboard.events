import { z } from "zod";
import {
  criterionIdSchema,
  planIdSchema,
  planStatusSchema,
  submissionIdSchema,
  trackIdSchema,
  userIdSchema,
  type CriterionId,
  type PlanId,
  type PlanStatus,
  type SubmissionId,
  type TrackId,
  type UserId,
} from "@/shared/contracts";

/**
 * What a scoring round is, as an organizer fills it in. `trackIds: null` means
 * "every track" — the UI's empty multi-select normalizes to it, because an empty
 * array would otherwise mean "no track at all" and route nothing to anybody.
 */
const planFields = z.object({
  planId: planIdSchema.nullable().default(null),
  name: z.string().trim().min(1).max(120),
  round: z.int().min(1).max(99).default(1),
  scaleMin: z.int().min(0).max(99).default(1),
  scaleMax: z.int().min(1).max(100).default(5),
  status: planStatusSchema.default("open"),
  trackIds: z.array(trackIdSchema).nullable().default(null),
  criteria: z.array(z.object({
    id: criterionIdSchema.nullable().default(null),
    label: z.string().trim().min(1).max(120),
    weight: z.number().positive().max(100).default(1),
  })).max(12).default([]),
});

const scaleIsOrdered = {
  check: (plan: { scaleMin: number; scaleMax: number }) => plan.scaleMax > plan.scaleMin,
  message: "The top of the scale has to be above the bottom",
  path: ["scaleMax"] as const,
};

export const planInputSchema = planFields.refine(scaleIsOrdered.check, {
  message: scaleIsOrdered.message,
  path: [...scaleIsOrdered.path],
});
export type PlanInput = z.infer<typeof planInputSchema>;

/**
 * The same round, edited. `expectedUpdatedAt` is the caller's copy of the row's
 * timestamp: sending it turns a concurrent edit into a conflict the organizer
 * can see instead of an overwrite they cannot.
 */
export const planUpdateSchema = planFields
  .extend({ expectedUpdatedAt: z.iso.datetime().optional() })
  .refine(scaleIsOrdered.check, { message: scaleIsOrdered.message, path: [...scaleIsOrdered.path] });
export type PlanUpdate = z.infer<typeof planUpdateSchema>;

export const reviewerAssignmentSchema = z.object({
  userId: userIdSchema,
  trackIds: z.array(trackIdSchema).nullable().default(null),
});
export type ReviewerAssignmentInput = z.infer<typeof reviewerAssignmentSchema>;

/**
 * One reviewer's verdict. Every score is optional: a review saved with a comment
 * and a blank criterion is legal and simply stays out of the average until it is
 * finished.
 */
export const reviewInputSchema = z.object({
  planId: planIdSchema,
  submissionId: submissionIdSchema,
  overallScore: z.number().nullable().default(null),
  criterionScores: z.record(criterionIdSchema, z.number()).default({}),
  comment: z.string().trim().max(2000).nullable().default(null),
});
export type ReviewInput = z.infer<typeof reviewInputSchema>;

export type PlanDTO = {
  id: PlanId;
  name: string;
  round: number;
  scaleMin: number;
  scaleMax: number;
  status: PlanStatus;
  trackIds: TrackId[] | null;
  criteria: Array<{ id: CriterionId; label: string; weight: number; sortOrder: number }>;
  reviewers: Array<{ userId: UserId; name: string; email: string; trackIds: TrackId[] | null; scored: number; assigned: number }>;
  /** Plan-level progress: scored submissions over submissions in the plan's scope. */
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
  myCriterionScores: Record<string, number>;
  myComment: string | null;
  scoredAt: string | null;
  avgRating: number | null;
  nScores: number;
};
