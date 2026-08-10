import { z } from "zod";
import { fileCommentAuthorRoleSchema, fileExportGroupBySchema, fileExportStatusSchema } from "./enums";
import {
  contactIdSchema,
  fileCommentIdSchema,
  fileExportJobIdSchema,
  fileIdSchema,
  fileRequestIdSchema,
  fileUploadIdSchema,
  sessionContentRevisionIdSchema,
  sessionIdSchema,
  submissionIdSchema,
  taskIdSchema,
} from "./ids";

/**
 * M52 — content and deliverables lifecycle. One numbered row per file-request
 * upload slot (request × contact × submission); `isLatest` is server-derived
 * and never settable by a client.
 */
export const fileVersionDtoSchema = z.object({
  fileUploadId: fileUploadIdSchema,
  fileAssetId: fileIdSchema,
  version: z.int().positive(),
  isLatest: z.boolean(),
  filename: z.string(),
  sizeBytes: z.int().nonnegative(),
  mime: z.string(),
  uploadedAt: z.iso.datetime(),
});
export type FileVersionDTO = z.infer<typeof fileVersionDtoSchema>;

export const fileCommentDtoSchema = z.object({
  id: fileCommentIdSchema,
  authorRole: fileCommentAuthorRoleSchema,
  authorName: z.string(),
  body: z.string(),
  createdAt: z.iso.datetime(),
});
export type FileCommentDTO = z.infer<typeof fileCommentDtoSchema>;

/** One deliverable slot: a file request assigned to a contact (and, for a
 * submission-targeted request, a specific submission), plus its latest file
 * and version/comment counts — the central Files view's row shape. */
export const deliverableRowDtoSchema = z.object({
  taskId: taskIdSchema,
  taskName: z.string(),
  fileRequestId: fileRequestIdSchema,
  fileRequestTitle: z.string(),
  contactId: contactIdSchema,
  contactName: z.string(),
  submissionId: submissionIdSchema.nullable(),
  submissionTitle: z.string().nullable(),
  dueAt: z.iso.datetime().nullable(),
  completed: z.boolean(),
  completedAt: z.iso.datetime().nullable(),
  overdue: z.boolean(),
  latestVersion: fileVersionDtoSchema.nullable(),
  versionCount: z.int().nonnegative(),
  commentCount: z.int().nonnegative(),
});
export type DeliverableRowDTO = z.infer<typeof deliverableRowDtoSchema>;

export const sessionContentRevisionDtoSchema = z.object({
  id: sessionContentRevisionIdSchema,
  sessionId: sessionIdSchema,
  title: z.string(),
  descriptionHtml: z.string(),
  editedByName: z.string().nullable(),
  restoredFromRevisionId: sessionContentRevisionIdSchema.nullable(),
  createdAt: z.iso.datetime(),
});
export type SessionContentRevisionDTO = z.infer<typeof sessionContentRevisionDtoSchema>;

export const fileExportJobDtoSchema = z.object({
  id: fileExportJobIdSchema,
  status: fileExportStatusSchema,
  groupBy: fileExportGroupBySchema,
  entryCount: z.int().nonnegative(),
  resultFileId: fileIdSchema.nullable(),
  error: z.string().nullable(),
  createdAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  expiresAt: z.iso.datetime().nullable(),
});
export type FileExportJobDTO = z.infer<typeof fileExportJobDtoSchema>;
