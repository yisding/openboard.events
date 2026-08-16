import { z } from "zod";

function brandedUuid<const Brand extends string>() {
  return z.uuid().brand<Brand>();
}

// M43 — organization tenancy. `OrganizationId` sits one level above
// `EventId`; every event belongs to exactly one organization.
export const organizationIdSchema = brandedUuid<"OrganizationId">();
export const eventIdSchema = brandedUuid<"EventId">();
export const userIdSchema = brandedUuid<"UserId">();
export const contactIdSchema = brandedUuid<"ContactId">();
export const formIdSchema = brandedUuid<"FormId">();
export const sectionIdSchema = brandedUuid<"SectionId">();
export const fieldIdSchema = brandedUuid<"FieldId">();
export const formVersionIdSchema = brandedUuid<"FormVersionId">();
export const submissionIdSchema = brandedUuid<"SubmissionId">();
export const participantIdSchema = brandedUuid<"ParticipantId">();
export const answerIdSchema = brandedUuid<"AnswerId">();
export const trackIdSchema = brandedUuid<"TrackId">();
export const roomIdSchema = brandedUuid<"RoomId">();
export const formatIdSchema = brandedUuid<"FormatId">();
export const tagIdSchema = brandedUuid<"TagId">();
export const sessionIdSchema = brandedUuid<"SessionId">();
export const taskIdSchema = brandedUuid<"TaskId">();
export const fileRequestIdSchema = brandedUuid<"FileRequestId">();
export const fileIdSchema = brandedUuid<"FileId">();
export const planIdSchema = brandedUuid<"PlanId">();
export const criterionIdSchema = brandedUuid<"CriterionId">();
export const reviewIdSchema = brandedUuid<"ReviewId">();
export const embedIdSchema = brandedUuid<"EmbedId">();
export const commLogIdSchema = brandedUuid<"CommLogId">();
export const apiKeyIdSchema = brandedUuid<"ApiKeyId">();
export const tokenIdSchema = brandedUuid<"TokenId">();
// M52 — content and deliverables lifecycle.
export const fileUploadIdSchema = brandedUuid<"FileUploadId">();
export const fileCommentIdSchema = brandedUuid<"FileCommentId">();
export const sessionContentRevisionIdSchema = brandedUuid<"SessionContentRevisionId">();
export const fileExportJobIdSchema = brandedUuid<"FileExportJobId">();
// M51 — standalone speaker roster operations.
export const logisticsFieldIdSchema = brandedUuid<"LogisticsFieldId">();
export const unavailabilityIdSchema = brandedUuid<"UnavailabilityId">();
// M44 — user management.
export const organizationInvitationIdSchema = brandedUuid<"OrganizationInvitationId">();
export const organizationAuditLogIdSchema = brandedUuid<"OrganizationAuditLogId">();
// M55 — organization-level speaker CRM.
export const organizationContactIdSchema = brandedUuid<"OrganizationContactId">();
export const crmTagIdSchema = brandedUuid<"CrmTagId">();
export const crmCustomFieldIdSchema = brandedUuid<"CrmCustomFieldId">();
export const crmNoteIdSchema = brandedUuid<"CrmNoteId">();
export const crmActivityIdSchema = brandedUuid<"CrmActivityId">();
export const crmSegmentIdSchema = brandedUuid<"CrmSegmentId">();
export const crmMergeIdSchema = brandedUuid<"CrmMergeId">();
export const crmPipelineIdSchema = brandedUuid<"CrmPipelineId">();
// M39 — per-event Airtable connection and its sync runs.
export const airtableConnectionIdSchema = brandedUuid<"AirtableConnectionId">();
export const airtableSyncRunIdSchema = brandedUuid<"AirtableSyncRunId">();

export type OrganizationId = z.infer<typeof organizationIdSchema>;
export type EventId = z.infer<typeof eventIdSchema>;
export type UserId = z.infer<typeof userIdSchema>;
export type ContactId = z.infer<typeof contactIdSchema>;
export type FormId = z.infer<typeof formIdSchema>;
export type SectionId = z.infer<typeof sectionIdSchema>;
export type FieldId = z.infer<typeof fieldIdSchema>;
export type FormVersionId = z.infer<typeof formVersionIdSchema>;
export type SubmissionId = z.infer<typeof submissionIdSchema>;
export type ParticipantId = z.infer<typeof participantIdSchema>;
export type AnswerId = z.infer<typeof answerIdSchema>;
export type TrackId = z.infer<typeof trackIdSchema>;
export type RoomId = z.infer<typeof roomIdSchema>;
export type FormatId = z.infer<typeof formatIdSchema>;
export type TagId = z.infer<typeof tagIdSchema>;
export type SessionId = z.infer<typeof sessionIdSchema>;
export type TaskId = z.infer<typeof taskIdSchema>;
export type FileRequestId = z.infer<typeof fileRequestIdSchema>;
export type FileId = z.infer<typeof fileIdSchema>;
export type PlanId = z.infer<typeof planIdSchema>;
export type CriterionId = z.infer<typeof criterionIdSchema>;
export type ReviewId = z.infer<typeof reviewIdSchema>;
export type EmbedId = z.infer<typeof embedIdSchema>;
export type CommLogId = z.infer<typeof commLogIdSchema>;
export type ApiKeyId = z.infer<typeof apiKeyIdSchema>;
export type TokenId = z.infer<typeof tokenIdSchema>;
export type FileUploadId = z.infer<typeof fileUploadIdSchema>;
export type FileCommentId = z.infer<typeof fileCommentIdSchema>;
export type SessionContentRevisionId = z.infer<typeof sessionContentRevisionIdSchema>;
export type FileExportJobId = z.infer<typeof fileExportJobIdSchema>;
export type LogisticsFieldId = z.infer<typeof logisticsFieldIdSchema>;
export type UnavailabilityId = z.infer<typeof unavailabilityIdSchema>;
export type OrganizationInvitationId = z.infer<typeof organizationInvitationIdSchema>;
export type OrganizationAuditLogId = z.infer<typeof organizationAuditLogIdSchema>;
export type OrganizationContactId = z.infer<typeof organizationContactIdSchema>;
export type CrmTagId = z.infer<typeof crmTagIdSchema>;
export type CrmCustomFieldId = z.infer<typeof crmCustomFieldIdSchema>;
export type CrmNoteId = z.infer<typeof crmNoteIdSchema>;
export type CrmActivityId = z.infer<typeof crmActivityIdSchema>;
export type CrmSegmentId = z.infer<typeof crmSegmentIdSchema>;
export type CrmMergeId = z.infer<typeof crmMergeIdSchema>;
export type CrmPipelineId = z.infer<typeof crmPipelineIdSchema>;
export type AirtableConnectionId = z.infer<typeof airtableConnectionIdSchema>;
export type AirtableSyncRunId = z.infer<typeof airtableSyncRunIdSchema>;
