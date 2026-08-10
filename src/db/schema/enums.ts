import { pgEnum } from "drizzle-orm/pg-core";
import {
  COMM_STATUSES,
  COMPLETION_VIAS,
  CRITERION_KINDS,
  CONFIRMATION_STATUSES,
  EMBED_CONTENT_TYPES,
  FIELD_TYPES,
  FILE_COMMENT_AUTHOR_ROLES,
  FILE_EXPORT_GROUP_BYS,
  FILE_EXPORT_STATUSES,
  FILE_KINDS,
  FORM_CONTEXTS,
  FORM_STATUSES,
  ICS_METHODS,
  MEMBER_ROLES,
  PARTICIPANT_ROLES,
  PLAN_STATUSES,
  REVIEW_ASSIGNMENT_STATUSES,
  REVIEW_VISIBILITIES,
  SESSION_STATUSES,
  SPEAKER_LOGISTICS_FIELD_TYPES,
  SPEAKER_WORKFLOW_STATUSES,
  SUBMISSION_KINDS,
  SUBMISSION_SOURCES,
  SUBMISSION_STATUSES,
  SUPPRESSION_REASONS,
  TASK_MODES,
  TASK_TARGETS,
  TEMPLATE_KEYS,
  TOKEN_PURPOSES,
} from "@/shared/contracts";

export const submissionStatusEnum = pgEnum("submission_status", SUBMISSION_STATUSES);
export const submissionKindEnum = pgEnum("submission_kind", SUBMISSION_KINDS);
export const submissionSourceEnum = pgEnum("submission_source", SUBMISSION_SOURCES);
export const formContextEnum = pgEnum("form_context", FORM_CONTEXTS);
export const formStatusEnum = pgEnum("form_status", FORM_STATUSES);
export const fieldTypeEnum = pgEnum("field_type", FIELD_TYPES);
export const participantRoleEnum = pgEnum("participant_role", PARTICIPANT_ROLES);
export const confirmationStatusEnum = pgEnum("confirmation_status", CONFIRMATION_STATUSES);
export const memberRoleEnum = pgEnum("member_role", MEMBER_ROLES);
export const taskTargetEnum = pgEnum("task_target", TASK_TARGETS);
export const taskModeEnum = pgEnum("task_mode", TASK_MODES);
export const completionViaEnum = pgEnum("completion_via", COMPLETION_VIAS);
export const sessionStatusEnum = pgEnum("session_status", SESSION_STATUSES);
export const planStatusEnum = pgEnum("plan_status", PLAN_STATUSES);
export const embedContentTypeEnum = pgEnum("embed_content_type", EMBED_CONTENT_TYPES);
export const templateKeyEnum = pgEnum("template_key", TEMPLATE_KEYS);
export const commStatusEnum = pgEnum("comm_status", COMM_STATUSES);
export const icsMethodEnum = pgEnum("ics_method", ICS_METHODS);
export const tokenPurposeEnum = pgEnum("token_purpose", TOKEN_PURPOSES);
export const fileKindEnum = pgEnum("file_kind", FILE_KINDS);
// M52 — content and deliverables lifecycle.
export const fileCommentAuthorRoleEnum = pgEnum("file_comment_author_role", FILE_COMMENT_AUTHOR_ROLES);
export const fileExportStatusEnum = pgEnum("file_export_status", FILE_EXPORT_STATUSES);
export const fileExportGroupByEnum = pgEnum("file_export_group_by", FILE_EXPORT_GROUP_BYS);
export const criterionKindEnum = pgEnum("criterion_kind", CRITERION_KINDS);
export const reviewVisibilityEnum = pgEnum("review_visibility", REVIEW_VISIBILITIES);
export const reviewAssignmentStatusEnum = pgEnum("review_assignment_status", REVIEW_ASSIGNMENT_STATUSES);
// P3-EMAIL — bounce/complaint suppression (drizzle/0007_email_compliance.sql).
export const suppressionReasonEnum = pgEnum("suppression_reason", SUPPRESSION_REASONS);
// M51 — standalone speaker roster operations (drizzle/0008_speaker_roster_operations.sql).
export const speakerWorkflowStatusEnum = pgEnum("speaker_workflow_status", SPEAKER_WORKFLOW_STATUSES);
export const speakerLogisticsFieldTypeEnum = pgEnum("speaker_logistics_field_type", SPEAKER_LOGISTICS_FIELD_TYPES);
