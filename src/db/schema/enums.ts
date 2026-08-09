import { pgEnum } from "drizzle-orm/pg-core";
import {
  COMM_STATUSES,
  COMPLETION_VIAS,
  CONFIRMATION_STATUSES,
  EMBED_CONTENT_TYPES,
  FIELD_TYPES,
  FILE_KINDS,
  FORM_CONTEXTS,
  FORM_STATUSES,
  ICS_METHODS,
  MEMBER_ROLES,
  PARTICIPANT_ROLES,
  PLAN_STATUSES,
  SESSION_STATUSES,
  SUBMISSION_KINDS,
  SUBMISSION_SOURCES,
  SUBMISSION_STATUSES,
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
