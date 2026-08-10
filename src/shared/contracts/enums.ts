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
export const EMBED_CONTENT_TYPES = ["agenda", "session_list", "schedule_itinerary", "speaker_list", "speaker_gallery"] as const;
// M50 adds the two review-operations keys, M51 the bulk-speaker-message key,
// M42 the two admin-auth keys, M44 the team-invitation key. They are
// appended, never reordered: `template_key` is a Postgres enum and its
// existing labels are already stored.
export const TEMPLATE_KEYS = ["submission_received", "submission_accepted", "submission_declined", "task_assigned", "task_reminder", "schedule_assigned", "schedule_changed", "portal_login", "reviewer_invited", "review_reminder", "speaker_bulk_message", "admin_password_reset", "admin_email_verification", "organization_invited"] as const;
// P3-EMAIL: `bounced`/`complained` record a Resend delivery-failure webhook
// against the log row that was actually sent (`sent` -> `bounced`/`complained`).
// Appended, never reordered — `comm_status` is a Postgres enum whose existing
// labels are already stored (same discipline as `TEMPLATE_KEYS` above).
export const COMM_STATUSES = ["queued", "sent", "failed", "skipped", "bounced", "complained"] as const;
// P3-EMAIL: why a contact is suppressed from ALL future sends (distinct from
// `unsubscribed_at`, which is the contact's own preference and only blocks
// non-essential mail — see `TRANSACTIONAL_TEMPLATE_KEYS` in `./comms`).
export const SUPPRESSION_REASONS = ["bounce", "complaint"] as const;
export const ICS_METHODS = ["request", "cancel"] as const;
export const TOKEN_PURPOSES = ["magic_link", "ics_download", "impersonation"] as const;
export const FILE_KINDS = ["logo", "background", "headshot", "attachment", "slide", "upload"] as const;
export const CONDITION_OPS = ["eq", "neq", "in", "not_in", "answered", "empty"] as const;
// M52 — content and deliverables lifecycle.
export const FILE_COMMENT_AUTHOR_ROLES = ["organizer", "speaker"] as const;
export const FILE_EXPORT_STATUSES = ["pending", "processing", "completed", "failed"] as const;
export const FILE_EXPORT_GROUP_BYS = ["none", "session", "speaker"] as const;
// M50 review operations. `REVIEW_VISIBILITIES` classifies a form field for blind
// review; `identity` is the fail-closed default, so a field nobody classified is
// withheld rather than leaked.
export const CRITERION_KINDS = ["numeric", "select", "text"] as const;
export const REVIEW_VISIBILITIES = ["content", "identity"] as const;
export const REVIEW_ASSIGNMENT_STATUSES = ["assigned", "recused"] as const;
// M51 — standalone speaker roster operations. `workflow_status` is pure
// organizer pipeline bookkeeping, deliberately distinct from
// `confirmation_status` (publication gate, resolution #15's auto-confirm) —
// see drizzle/0008's header comment. `speaker_logistics_field` types mirror
// the two kinds an organizer can define on an event-scoped custom field.
export const SPEAKER_WORKFLOW_STATUSES = ["new", "contacted", "invited", "confirmed", "declined", "withdrawn"] as const;
export const SPEAKER_LOGISTICS_FIELD_TYPES = ["text", "select"] as const;
// M49 — billing scaffold. `BILLING_PLAN_IDS` is the small, hand-seeded plan
// catalog (`drizzle/0012_billing_scaffold.sql`'s `billing_plans` table uses
// these as its literal primary keys, not a Postgres enum, so adding a plan
// later is an INSERT, not a migration). `SUBSCRIPTION_STATUSES` backs the one
// real enum this module adds, `organization_subscriptions.status`.
export const BILLING_PLAN_IDS = ["free", "pro", "enterprise"] as const;
export const SUBSCRIPTION_STATUSES = ["trialing", "active", "past_due", "canceled"] as const;
// M55 — organization-level speaker CRM. `CRM_CONTACT_SOURCES` records how an
// organization identity first came into being; `merge` is stamped on a row
// only as the *result* of `mergeOrganizationContactsIn` absorbing another —
// never chosen by an organizer directly. `CRM_ACTIVITY_KINDS` is the closed
// vocabulary every mutation in `src/features/crm` appends to the append-only
// timeline with; `CRM_PIPELINE_STAGES` is deliberately the three-state
// lifecycle the work order names (open/won/lost), not a wider custom-stage
// kanban. Custom-field types reuse `SPEAKER_LOGISTICS_FIELD_TYPES`
// (`speakerLogisticsFieldTypeSchema`/`speaker_logistics_field_type`) rather
// than declaring a second identical text/select enum.
export const CRM_CONTACT_SOURCES = ["manual", "import", "event_sync", "merge"] as const;
export const CRM_ACTIVITY_KINDS = [
  "created", "note_added", "tag_added", "tag_removed", "field_changed",
  "event_linked", "merged_from", "merged_into", "pipeline_created",
  "pipeline_stage_changed", "email_sent", "imported",
] as const;
export const CRM_PIPELINE_STAGES = ["open", "won", "lost"] as const;

export const submissionStatusSchema = z.enum(SUBMISSION_STATUSES);
export const submissionKindSchema = z.enum(SUBMISSION_KINDS);
export const submissionSourceSchema = z.enum(SUBMISSION_SOURCES);
export const formContextSchema = z.enum(FORM_CONTEXTS);
export const formStatusSchema = z.enum(FORM_STATUSES);
export const fieldTypeSchema = z.enum(FIELD_TYPES);
export const participantRoleSchema = z.enum(PARTICIPANT_ROLES);
export const confirmationStatusSchema = z.enum(CONFIRMATION_STATUSES);
export const memberRoleSchema = z.enum(MEMBER_ROLES);
export const taskTargetSchema = z.enum(TASK_TARGETS);
export const taskModeSchema = z.enum(TASK_MODES);
export const completionViaSchema = z.enum(COMPLETION_VIAS);
export const sessionStatusSchema = z.enum(SESSION_STATUSES);
export const planStatusSchema = z.enum(PLAN_STATUSES);
export const embedContentTypeSchema = z.enum(EMBED_CONTENT_TYPES);
export const templateKeySchema = z.enum(TEMPLATE_KEYS);
export const commStatusSchema = z.enum(COMM_STATUSES);
export const icsMethodSchema = z.enum(ICS_METHODS);
export const tokenPurposeSchema = z.enum(TOKEN_PURPOSES);
export const fileKindSchema = z.enum(FILE_KINDS);
export const conditionOpSchema = z.enum(CONDITION_OPS);
export const fileCommentAuthorRoleSchema = z.enum(FILE_COMMENT_AUTHOR_ROLES);
export const fileExportStatusSchema = z.enum(FILE_EXPORT_STATUSES);
export const fileExportGroupBySchema = z.enum(FILE_EXPORT_GROUP_BYS);
export const criterionKindSchema = z.enum(CRITERION_KINDS);
export const reviewVisibilitySchema = z.enum(REVIEW_VISIBILITIES);
export const reviewAssignmentStatusSchema = z.enum(REVIEW_ASSIGNMENT_STATUSES);
export const suppressionReasonSchema = z.enum(SUPPRESSION_REASONS);
export const speakerWorkflowStatusSchema = z.enum(SPEAKER_WORKFLOW_STATUSES);
export const speakerLogisticsFieldTypeSchema = z.enum(SPEAKER_LOGISTICS_FIELD_TYPES);
// M49 — billing scaffold. Named `billingPlanIdSchema` (not `planIdSchema`)
// because `PlanId` already names M50's evaluation-round plan id (`./ids.ts`,
// `evaluation_plans`) — a different `plans` table entirely.
export const billingPlanIdSchema = z.enum(BILLING_PLAN_IDS);
export const subscriptionStatusSchema = z.enum(SUBSCRIPTION_STATUSES);
export const crmContactSourceSchema = z.enum(CRM_CONTACT_SOURCES);
export const crmActivityKindSchema = z.enum(CRM_ACTIVITY_KINDS);
export const crmPipelineStageSchema = z.enum(CRM_PIPELINE_STAGES);

export type SubmissionStatus = z.infer<typeof submissionStatusSchema>;
export type SubmissionKind = z.infer<typeof submissionKindSchema>;
export type SubmissionSource = z.infer<typeof submissionSourceSchema>;
export type FormContext = z.infer<typeof formContextSchema>;
export type FormStatus = z.infer<typeof formStatusSchema>;
export type FieldType = z.infer<typeof fieldTypeSchema>;
export type ParticipantRole = z.infer<typeof participantRoleSchema>;
export type ConfirmationStatus = z.infer<typeof confirmationStatusSchema>;
export type MemberRole = z.infer<typeof memberRoleSchema>;
export type TaskTarget = z.infer<typeof taskTargetSchema>;
export type TaskMode = z.infer<typeof taskModeSchema>;
export type CompletionVia = z.infer<typeof completionViaSchema>;
export type SessionStatus = z.infer<typeof sessionStatusSchema>;
export type PlanStatus = z.infer<typeof planStatusSchema>;
export type EmbedContentType = z.infer<typeof embedContentTypeSchema>;
export type TemplateKey = z.infer<typeof templateKeySchema>;
export type CommStatus = z.infer<typeof commStatusSchema>;
export type IcsMethod = z.infer<typeof icsMethodSchema>;
export type TokenPurpose = z.infer<typeof tokenPurposeSchema>;
export type FileKind = z.infer<typeof fileKindSchema>;
export type ConditionOp = z.infer<typeof conditionOpSchema>;
export type SuppressionReason = z.infer<typeof suppressionReasonSchema>;
export type FileCommentAuthorRole = z.infer<typeof fileCommentAuthorRoleSchema>;
export type FileExportStatus = z.infer<typeof fileExportStatusSchema>;
export type FileExportGroupBy = z.infer<typeof fileExportGroupBySchema>;
export type CriterionKind = z.infer<typeof criterionKindSchema>;
export type ReviewVisibility = z.infer<typeof reviewVisibilitySchema>;
export type ReviewAssignmentStatus = z.infer<typeof reviewAssignmentStatusSchema>;
export type SpeakerWorkflowStatus = z.infer<typeof speakerWorkflowStatusSchema>;
export type SpeakerLogisticsFieldType = z.infer<typeof speakerLogisticsFieldTypeSchema>;
export type BillingPlanId = z.infer<typeof billingPlanIdSchema>;
export type SubscriptionStatus = z.infer<typeof subscriptionStatusSchema>;
export type CrmContactSource = z.infer<typeof crmContactSourceSchema>;
export type CrmActivityKind = z.infer<typeof crmActivityKindSchema>;
export type CrmPipelineStage = z.infer<typeof crmPipelineStageSchema>;

// Temporary name retained for the merged demo adapter while server consumers
// use the canonical CONDITION_OPS name.
export const CONDITION_OPERATORS = CONDITION_OPS;
export type ConditionOperator = ConditionOp;
