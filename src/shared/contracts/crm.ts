import { z } from "zod";
import { crmActivityKindSchema, crmContactSourceSchema, crmPipelineStageSchema, speakerLogisticsFieldTypeSchema } from "./enums";
import {
  contactIdSchema,
  crmActivityIdSchema,
  crmCustomFieldIdSchema,
  crmMergeIdSchema,
  crmNoteIdSchema,
  crmPipelineIdSchema,
  crmSegmentIdSchema,
  crmTagIdSchema,
  eventIdSchema,
  organizationContactIdSchema,
  sessionIdSchema,
  userIdSchema,
} from "./ids";

/**
 * M55 — organization-level speaker CRM contracts. Additive only: nothing
 * here changes an existing export. `organizationContactDtoSchema` is a
 * deliberately separate identity from `ContactDTO`-shaped event contacts
 * (the guardrail — CRM never collapses event rows into itself); the two are
 * connected only through `organizationContactId`/`contactId` link rows, read
 * by `getOrganizationContactHistory`.
 */

const iso = z.iso.datetime();

// --- Directory identity ------------------------------------------------

export const organizationContactDtoSchema = z.object({
  id: organizationContactIdSchema,
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  company: z.string().nullable(),
  jobTitle: z.string().nullable(),
  bioHtml: z.string().nullable(),
  linkedinUrl: z.string().nullable(),
  twitterUrl: z.string().nullable(),
  websiteUrl: z.string().nullable(),
  source: crmContactSourceSchema,
  customFields: z.record(z.string(), z.string()),
  mergedIntoId: organizationContactIdSchema.nullable(),
  createdAt: iso,
  updatedAt: iso,
});
export type OrganizationContactDTO = z.infer<typeof organizationContactDtoSchema>;

/** The directory list/search row — the DTO above plus the aggregates a
 * results table needs without an N+1 per row (tag names, how many events the
 * identity has touched, last activity). */
export const organizationContactSummaryDtoSchema = organizationContactDtoSchema.extend({
  tags: z.array(z.object({ id: crmTagIdSchema, name: z.string(), color: z.string() })),
  eventCount: z.number().int(),
  lastActivityAt: iso.nullable(),
});
export type OrganizationContactSummaryDTO = z.infer<typeof organizationContactSummaryDtoSchema>;

export const createOrganizationContactInputSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  firstName: z.string().trim().max(120).optional(),
  lastName: z.string().trim().max(120).optional(),
  company: z.string().trim().max(160).optional(),
  jobTitle: z.string().trim().max(160).optional(),
  linkedinUrl: z.union([z.url(), z.literal("")]).optional(),
  twitterUrl: z.union([z.url(), z.literal("")]).optional(),
  websiteUrl: z.union([z.url(), z.literal("")]).optional(),
});
export type CreateOrganizationContactInput = z.infer<typeof createOrganizationContactInputSchema>;

export const updateOrganizationContactInputSchema = z.object({
  firstName: z.string().trim().max(120).optional(),
  lastName: z.string().trim().max(120).optional(),
  company: z.string().trim().max(160).nullable().optional(),
  jobTitle: z.string().trim().max(160).nullable().optional(),
  linkedinUrl: z.union([z.url(), z.literal(""), z.null()]).optional(),
  twitterUrl: z.union([z.url(), z.literal(""), z.null()]).optional(),
  websiteUrl: z.union([z.url(), z.literal(""), z.null()]).optional(),
  // Keyed by custom-field `key` (not id) — a present key with an empty
  // string clears that field's value for this contact.
  customFields: z.record(z.string(), z.string().max(2_000)).optional(),
}).refine((input) => Object.keys(input).length > 0, { message: "Provide at least one field to update" });
export type UpdateOrganizationContactInput = z.infer<typeof updateOrganizationContactInputSchema>;

export const directoryFilterSchema = z.object({
  search: z.string().trim().max(200).optional(),
  tagIds: z.array(crmTagIdSchema).min(1).optional(),
  eventIds: z.array(eventIdSchema).min(1).optional(),
  hasEventLink: z.boolean().optional(),
  pipelineStage: z.array(crmPipelineStageSchema).min(1).optional(),
  source: z.array(crmContactSourceSchema).min(1).optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});
export type DirectoryFilter = z.infer<typeof directoryFilterSchema>;

export const directoryPageDtoSchema = z.object({
  rows: z.array(organizationContactSummaryDtoSchema),
  total: z.number().int(),
});
export type DirectoryPageDTO = z.infer<typeof directoryPageDtoSchema>;

// --- Tags ----------------------------------------------------------------

export const crmTagDtoSchema = z.object({ id: crmTagIdSchema, name: z.string(), color: z.string(), createdAt: iso });
export type CrmTagDTO = z.infer<typeof crmTagDtoSchema>;

export const createCrmTagInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  color: z.string().trim().regex(/^#[0-9a-f]{6}$/iu).default("#00a878"),
});
export type CreateCrmTagInput = z.infer<typeof createCrmTagInputSchema>;

export const setCrmContactTagsInputSchema = z.object({ tagIds: z.array(crmTagIdSchema) });
export type SetCrmContactTagsInput = z.infer<typeof setCrmContactTagsInputSchema>;

// --- Custom fields ---------------------------------------------------------

export const crmCustomFieldDtoSchema = z.object({
  id: crmCustomFieldIdSchema,
  key: z.string(),
  label: z.string(),
  fieldType: speakerLogisticsFieldTypeSchema,
  options: z.array(z.string()),
  sortOrder: z.number().int(),
});
export type CrmCustomFieldDTO = z.infer<typeof crmCustomFieldDtoSchema>;

export const createCrmCustomFieldInputSchema = z.object({
  key: z.string().trim().min(1).max(60).regex(/^[a-z0-9][a-z0-9_]*$/u, "lowercase letters, numbers and underscores only"),
  label: z.string().trim().min(1).max(120),
  fieldType: speakerLogisticsFieldTypeSchema.default("text"),
  options: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
}).refine((input) => input.fieldType !== "select" || input.options.length > 0, {
  message: "A select field needs at least one option",
  path: ["options"],
});
export type CreateCrmCustomFieldInput = z.infer<typeof createCrmCustomFieldInputSchema>;

// --- Notes and activity ----------------------------------------------------

export const crmNoteDtoSchema = z.object({
  id: crmNoteIdSchema,
  bodyHtml: z.string(),
  authorUserId: userIdSchema.nullable(),
  authorName: z.string().nullable(),
  createdAt: iso,
});
export type CrmNoteDTO = z.infer<typeof crmNoteDtoSchema>;

export const createCrmNoteInputSchema = z.object({ bodyHtml: z.string().trim().min(1).max(5_000) });
export type CreateCrmNoteInput = z.infer<typeof createCrmNoteInputSchema>;

export const crmActivityDtoSchema = z.object({
  id: crmActivityIdSchema,
  kind: crmActivityKindSchema,
  actorUserId: userIdSchema.nullable(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: iso,
});
export type CrmActivityDTO = z.infer<typeof crmActivityDtoSchema>;

// --- Cross-event history ----------------------------------------------------

export const crmEventLinkDtoSchema = z.object({
  eventId: eventIdSchema,
  eventName: z.string(),
  eventSlug: z.string(),
  contactId: contactIdSchema,
  workflowStatus: z.string(),
  confirmationStatus: z.string(),
  sessions: z.array(z.object({ sessionId: sessionIdSchema, title: z.string(), status: z.string() })),
  linkedAt: iso,
});
export type CrmEventLinkDTO = z.infer<typeof crmEventLinkDtoSchema>;

export const organizationContactHistoryDtoSchema = z.object({
  contact: organizationContactDtoSchema,
  tags: z.array(crmTagDtoSchema),
  events: z.array(crmEventLinkDtoSchema),
  notes: z.array(crmNoteDtoSchema),
  activity: z.array(crmActivityDtoSchema),
});
export type OrganizationContactHistoryDTO = z.infer<typeof organizationContactHistoryDtoSchema>;

// --- Push into an event (M51 reuse) -----------------------------------------

export const pushOrganizationContactToEventInputSchema = z.object({ eventId: eventIdSchema });
export type PushOrganizationContactToEventInput = z.infer<typeof pushOrganizationContactToEventInputSchema>;

export const pushOrganizationContactToEventResultSchema = z.object({
  contactId: contactIdSchema,
  created: z.boolean(), // false when an event contact under this email already existed and was linked, not created
  alreadyLinked: z.boolean(), // true when this exact (event, organization contact) link already existed — no-op
});
export type PushOrganizationContactToEventResult = z.infer<typeof pushOrganizationContactToEventResultSchema>;

// --- CSV import --------------------------------------------------------------

export const CRM_CSV_FIELDS = ["firstName", "lastName", "company", "jobTitle", "linkedinUrl", "twitterUrl", "websiteUrl"] as const;
export type CrmCsvField = (typeof CRM_CSV_FIELDS)[number];

export const crmCsvColumnMappingInputSchema = z.object({
  email: z.number().int().nonnegative(),
  fields: z.partialRecord(z.enum(CRM_CSV_FIELDS), z.number().int().nonnegative()).default({}),
});
export type CrmCsvColumnMapping = z.infer<typeof crmCsvColumnMappingInputSchema>;

export const importCrmContactsCsvInputSchema = z.object({
  csvText: z.string().min(1).max(2_000_000),
  mapping: crmCsvColumnMappingInputSchema,
  mode: z.enum(["preview", "commit"]),
});
export type ImportCrmContactsCsvInput = z.infer<typeof importCrmContactsCsvInputSchema>;

export const crmCsvRowOutcomeSchema = z.object({
  rowNumber: z.number().int(),
  email: z.string().nullable(),
  status: z.enum(["created", "matched_existing", "duplicate_in_file", "error"]),
  error: z.string().nullable(),
  organizationContactId: organizationContactIdSchema.nullable(),
});
export type CrmCsvRowOutcome = z.infer<typeof crmCsvRowOutcomeSchema>;

export const importCrmContactsCsvResultSchema = z.object({
  rows: z.array(crmCsvRowOutcomeSchema),
  created: z.number().int(),
  matchedExisting: z.number().int(),
  errors: z.number().int(),
});
export type ImportCrmContactsCsvResult = z.infer<typeof importCrmContactsCsvResultSchema>;

// --- Merge -------------------------------------------------------------------

export const previewCrmMergeInputSchema = z.object({
  primaryContactId: organizationContactIdSchema,
  mergedContactId: organizationContactIdSchema,
}).refine((input) => input.primaryContactId !== input.mergedContactId, { message: "Choose two different contacts to merge" });
export type PreviewCrmMergeInput = z.infer<typeof previewCrmMergeInputSchema>;

export const crmMergeReferenceCountsSchema = z.object({
  eventLinks: z.number().int(),
  tags: z.number().int(),
  notes: z.number().int(),
  activity: z.number().int(),
  pipelineEntries: z.number().int(),
});
export type CrmMergeReferenceCounts = z.infer<typeof crmMergeReferenceCountsSchema>;

export const crmMergePreviewDtoSchema = z.object({
  primary: organizationContactDtoSchema,
  merged: organizationContactDtoSchema,
  referenceCounts: crmMergeReferenceCountsSchema,
  // Fields where the two contacts disagree, so the UI can offer a
  // field-by-field pick before commit. Value is null when the merged side
  // has nothing to offer for that field.
  fieldConflicts: z.array(z.object({ field: z.string(), primaryValue: z.string().nullable(), mergedValue: z.string().nullable() })),
});
export type CrmMergePreviewDTO = z.infer<typeof crmMergePreviewDtoSchema>;

/** Field-by-field resolution: for each conflicting field, "primary" keeps
 * the primary contact's current value, "merged" overwrites it with the
 * losing contact's value. Unlisted fields default to "primary" (keep). */
export const mergeCrmContactsInputSchema = z.object({
  primaryContactId: organizationContactIdSchema,
  mergedContactId: organizationContactIdSchema,
  fieldResolutions: z.record(z.string(), z.enum(["primary", "merged"])).default({}),
}).refine((input) => input.primaryContactId !== input.mergedContactId, { message: "Choose two different contacts to merge" });
export type MergeCrmContactsInput = z.infer<typeof mergeCrmContactsInputSchema>;

export const crmMergeAuditDtoSchema = z.object({
  id: crmMergeIdSchema,
  primaryContactId: organizationContactIdSchema,
  mergedContactId: organizationContactIdSchema,
  actorUserId: userIdSchema.nullable(),
  referenceCounts: crmMergeReferenceCountsSchema,
  createdAt: iso,
});
export type CrmMergeAuditDTO = z.infer<typeof crmMergeAuditDtoSchema>;

export const crmMergeRecoveryStatusSchema = z.enum(["recoverable", "recovered", "unavailable"]);
export type CrmMergeRecoveryStatus = z.infer<typeof crmMergeRecoveryStatusSchema>;

/** Organization-scoped audit lookup. The recovery flag is derived from the
 * append-only recovery record and the snapshot captured at merge time; the
 * snapshot itself is intentionally never returned to the browser. */
export const crmMergeAuditDetailDtoSchema = crmMergeAuditDtoSchema.extend({
  recoveryStatus: crmMergeRecoveryStatusSchema,
  canRecover: z.boolean(),
});
export type CrmMergeAuditDetailDTO = z.infer<typeof crmMergeAuditDetailDtoSchema>;

// --- Segments ------------------------------------------------------------

/** AND semantics across every provided field, same convention M46's
 * `speakerSegmentFilterSchema` uses one scope down. `tagIds` requires ALL
 * listed tags present (not any); every other array field is ANY-of. */
export const crmSegmentFilterSchema = z.object({
  search: z.string().trim().max(200).optional(),
  tagIds: z.array(crmTagIdSchema).min(1).optional(),
  eventIds: z.array(eventIdSchema).min(1).optional(),
  pipelineStage: z.array(crmPipelineStageSchema).min(1).optional(),
  source: z.array(crmContactSourceSchema).min(1).optional(),
});
export type CrmSegmentFilter = z.infer<typeof crmSegmentFilterSchema>;

export const crmSegmentDtoSchema = z.object({
  id: crmSegmentIdSchema,
  name: z.string(),
  filter: crmSegmentFilterSchema,
  createdAt: iso,
  updatedAt: iso,
});
export type CrmSegmentDTO = z.infer<typeof crmSegmentDtoSchema>;

export const createCrmSegmentInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  filter: crmSegmentFilterSchema,
});
export type CreateCrmSegmentInput = z.infer<typeof createCrmSegmentInputSchema>;

export const resolvedCrmSegmentSchema = z.object({
  matchedCount: z.number().int(),
  organizationContactIds: z.array(organizationContactIdSchema),
  capped: z.boolean(),
  preview: z.array(z.object({ organizationContactId: organizationContactIdSchema, email: z.string(), name: z.string() })),
});
export type ResolvedCrmSegment = z.infer<typeof resolvedCrmSegmentSchema>;

// --- Bulk communication (delegates to M51's composeBulkSpeakerEmailIn per event) --

/**
 * `mode: "send"` fans out per organization contact to the event the CRM
 * pushed/matched it into most recently (`organization_contact_links`, latest
 * `created_at`) and reuses `composeBulkSpeakerEmailIn` unchanged for that
 * event's group — the existing outbox/compliance path (suppression,
 * unsubscribe, idempotent `speaker_bulk_messages` rows). An organization
 * contact with no event link yet cannot receive a CRM bulk email; it is
 * reported back as skipped with a specific reason rather than silently
 * dropped.
 */
const crmBulkEmailBaseSchema = z.object({
  organizationContactIds: z.array(organizationContactIdSchema).min(1).max(500),
  subject: z.string().trim().min(1).max(200),
  bodyHtml: z.string().trim().min(1).max(20_000),
});
export const composeCrmBulkEmailInputSchema = z.discriminatedUnion("mode", [
  crmBulkEmailBaseSchema.extend({
    mode: z.literal("preview"),
    previewOrganizationContactId: organizationContactIdSchema.optional(),
  }),
  crmBulkEmailBaseSchema.extend({
    mode: z.literal("send"),
    sendId: z.uuid(),
  }),
]);
export type ComposeCrmBulkEmailInput = z.infer<typeof composeCrmBulkEmailInputSchema>;

export const composeCrmBulkEmailResultSchema = z.object({
  queued: z.number().int(),
  alreadyQueued: z.number().int(),
  skipped: z.number().int(),
  errors: z.array(z.object({ organizationContactId: organizationContactIdSchema, reason: z.string() })),
  preview: z.object({ recipientEmail: z.email(), recipientName: z.string(), subject: z.string(), bodyHtml: z.string() }).nullable(),
});
export type ComposeCrmBulkEmailResult = z.infer<typeof composeCrmBulkEmailResultSchema>;

// --- Sourcing pipeline -------------------------------------------------------

export const crmPipelineEntryDtoSchema = z.object({
  id: crmPipelineIdSchema,
  organizationContactId: organizationContactIdSchema,
  targetEventId: eventIdSchema.nullable(),
  stage: crmPipelineStageSchema,
  notes: z.string().nullable(),
  createdAt: iso,
  updatedAt: iso,
});
export type CrmPipelineEntryDTO = z.infer<typeof crmPipelineEntryDtoSchema>;

export const createCrmPipelineEntryInputSchema = z.object({
  organizationContactId: organizationContactIdSchema,
  targetEventId: eventIdSchema.nullable().optional(),
  notes: z.string().trim().max(2_000).optional(),
});
export type CreateCrmPipelineEntryInput = z.infer<typeof createCrmPipelineEntryInputSchema>;

export const transitionCrmPipelineInputSchema = z.object({ stage: crmPipelineStageSchema });
export type TransitionCrmPipelineInput = z.infer<typeof transitionCrmPipelineInputSchema>;

export const crmPipelineHistoryEntryDtoSchema = z.object({
  fromStage: crmPipelineStageSchema.nullable(),
  toStage: crmPipelineStageSchema,
  actorUserId: userIdSchema.nullable(),
  createdAt: iso,
});
export type CrmPipelineHistoryEntryDTO = z.infer<typeof crmPipelineHistoryEntryDtoSchema>;

// --- Metrics -------------------------------------------------------------

export const crmMetricsDtoSchema = z.object({
  totalContacts: z.number().int(),
  totalWithEventLink: z.number().int(),
  totalTagged: z.number().int(),
  eventsRepresented: z.number().int(),
  pipelineByStage: z.record(crmPipelineStageSchema, z.number().int()),
  mergesRecorded: z.number().int(),
});
export type CrmMetricsDTO = z.infer<typeof crmMetricsDtoSchema>;
