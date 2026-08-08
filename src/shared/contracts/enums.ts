import { z } from "zod";

export const SUBMISSION_STATUSES = ["draft", "pending", "accept_queue", "decline_queue", "accepted", "declined", "withdrawn"] as const;
export const SUBMISSION_KINDS = ["abstract", "session"] as const;
export const SUBMISSION_SOURCES = ["cfp", "manual", "import"] as const;
export const FORM_CONTEXTS = ["cfp", "portal"] as const;
export const FORM_STATUSES = ["draft", "open", "closed"] as const;
export const FIELD_TYPES = ["text", "textarea", "richtext", "dropdown", "multiselect", "radio", "checkbox", "email", "phone", "url", "number", "date", "file"] as const;
export const COMMITTED_FIELD_TYPES = ["text", "textarea", "richtext", "dropdown", "multiselect", "email", "url", "file"] as const;
export const PARTICIPANT_ROLES = ["speaker", "co_speaker", "moderator", "panelist"] as const;
export const CONFIRMATION_STATUSES = ["unconfirmed", "confirmed", "declined"] as const;
export const MEMBER_ROLES = ["owner", "organizer", "reviewer"] as const;
export const TASK_TARGETS = ["contact", "submission"] as const;
export const TASK_MODES = ["manual", "form", "file_request"] as const;
export const COMPLETION_VIAS = ["manual", "form_response", "file_upload", "admin"] as const;
export const SESSION_STATUSES = ["draft", "published"] as const;
export const PLAN_STATUSES = ["open", "closed"] as const;
export const CONDITION_OPERATORS = ["eq", "neq", "in", "not_in", "answered", "empty"] as const;

export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];
export type FieldType = (typeof FIELD_TYPES)[number];
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];
export const submissionStatusSchema = z.enum(SUBMISSION_STATUSES);
export const fieldTypeSchema = z.enum(FIELD_TYPES);
