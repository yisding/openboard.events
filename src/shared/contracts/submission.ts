import { z } from "zod";
import { participantRoleSchema, submissionSourceSchema, submissionStatusSchema } from "./enums";
import { cleanAnswersSchema } from "./forms";
import {
  contactIdSchema,
  formIdSchema,
  formatIdSchema,
  submissionIdSchema,
  tagIdSchema,
  trackIdSchema,
} from "./ids";

const speakerSummarySchema = z.object({
  contactId: contactIdSchema,
  name: z.string(),
  isPrimary: z.boolean(),
});

export const submissionListRowSchema = z.object({
  submissionId: submissionIdSchema,
  code: z.int().positive(),
  status: submissionStatusSchema,
  source: submissionSourceSchema,
  formId: formIdSchema.nullable(),
  formName: z.string().nullable(),
  title: z.string(),
  descriptionPlain: z.string().nullable(),
  submitterEmail: z.email().nullable(),
  submitterName: z.string().nullable(),
  speakers: z.array(speakerSummarySchema),
  trackId: trackIdSchema.nullable(),
  trackName: z.string().nullable(),
  trackColor: z.string().nullable(),
  tags: z.array(z.object({ id: tagIdSchema, name: z.string() })),
  rating: z.number().nullable(),
  nScores: z.int().nonnegative(),
  notifiedAt: z.iso.datetime().nullable(),
  submittedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  formatName: z.string().nullable(),
  language: z.string().nullable(),
  level: z.string().nullable(),
  capacity: z.int().nullable(),
  clientSessionId: z.string().nullable(),
  rowVersion: z.int().positive(),
});
export type SubmissionListRow = z.infer<typeof submissionListRowSchema>;

export const answerPanelDataSchema = z.object({
  snapshot: z.unknown(),
  answers: z.array(z.object({ fieldId: z.string(), participantId: z.string().nullable(), value: z.unknown() })),
});

export const submissionDetailDtoSchema = submissionListRowSchema.extend({
  descriptionHtml: z.string().nullable(),
  startsAt: z.iso.datetime().nullable(),
  endsAt: z.iso.datetime().nullable(),
  participants: z.array(z.object({
    id: z.string(),
    contactId: contactIdSchema,
    name: z.string(),
    email: z.email(),
    role: participantRoleSchema,
    isPrimary: z.boolean(),
    sortOrder: z.int(),
  })),
  answerPanel: answerPanelDataSchema,
});
export type SubmissionDetailDTO = z.infer<typeof submissionDetailDtoSchema>;

export const acceptedForSchedulingRowSchema = z.object({
  submissionId: submissionIdSchema,
  code: z.int().positive(),
  title: z.string(),
  descriptionHtml: z.string().nullable(),
  trackId: trackIdSchema.nullable(),
  formatId: formatIdSchema.nullable(),
  alreadyPromoted: z.boolean(),
  speakers: z.array(speakerSummarySchema.extend({ role: participantRoleSchema })),
});
export type AcceptedForSchedulingRow = z.infer<typeof acceptedForSchedulingRowSchema>;

export const createSubmissionInputSchema = z.object({
  formId: formIdSchema.nullable(),
  formVersion: z.int().positive().nullable(),
  source: submissionSourceSchema,
  kind: z.enum(["abstract", "session"]),
  initialStatus: submissionStatusSchema.optional(),
  submitterContactId: contactIdSchema.nullable(),
  draftSubmissionId: submissionIdSchema.nullable().optional(),
  fields: z.object({
    title: z.string(),
    descriptionHtml: z.string().nullable().optional(),
    trackId: trackIdSchema.nullable().optional(),
    formatId: formatIdSchema.nullable().optional(),
    level: z.string().nullable().optional(),
    language: z.string().nullable().optional(),
    capacity: z.int().nullable().optional(),
    startsAt: z.date().nullable().optional(),
    endsAt: z.date().nullable().optional(),
    clientSessionId: z.string().nullable().optional(),
  }),
  participants: z.array(z.object({
    contactId: contactIdSchema,
    role: participantRoleSchema,
    isPrimary: z.boolean(),
    sortOrder: z.int(),
  })),
  answers: cleanAnswersSchema,
  routing: z.object({ setTrackId: trackIdSchema.nullable(), addTagIds: z.array(tagIdSchema) }).nullable().optional(),
  tagIds: z.array(tagIdSchema).optional(),
  enforce: z.object({ deadline: z.boolean().optional(), limit: z.boolean().optional() }).optional(),
  sendConfirmation: z.boolean().optional(),
});
// Drafts never consume the submission limit.
export type CreateSubmissionInput = z.infer<typeof createSubmissionInputSchema>;
