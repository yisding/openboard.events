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
  sessionPlacementRevisionIdSchema,
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

/**
 * MTP-07 — one recorded move of a session: where it was, where it went, who
 * moved it and when.
 *
 * Room *names* rather than room ids, and both sides frozen at write time: a
 * room that is later renamed or deleted must not silently rewrite (or erase)
 * the history of the placements it once held.
 */
const placementSideSchema = z.object({
  startsAt: z.iso.datetime().nullable(),
  endsAt: z.iso.datetime().nullable(),
  roomName: z.string().nullable(),
});
export const sessionPlacementRevisionDtoSchema = z.object({
  id: sessionPlacementRevisionIdSchema,
  sessionId: sessionIdSchema,
  from: placementSideSchema,
  to: placementSideSchema,
  movedByName: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type SessionPlacementRevisionDTO = z.infer<typeof sessionPlacementRevisionDtoSchema>;

/** Both halves of a session's history, in one round trip for the editor dialog. */
export const sessionHistoryDtoSchema = z.object({
  content: z.array(sessionContentRevisionDtoSchema),
  placements: z.array(sessionPlacementRevisionDtoSchema),
});
export type SessionHistoryDTO = z.infer<typeof sessionHistoryDtoSchema>;

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
