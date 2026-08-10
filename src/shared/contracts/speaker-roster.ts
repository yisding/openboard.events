import { z } from "zod";
import { confirmationStatusSchema, speakerLogisticsFieldTypeSchema, speakerWorkflowStatusSchema } from "./enums";
import { contactIdSchema, logisticsFieldIdSchema, unavailabilityIdSchema } from "./ids";
import { SPEAKER_CSV_FIELDS } from "./speaker-csv-fields";

/**
 * M51 — standalone speaker roster operations. Input/DTO schemas the
 * `src/features/portal/server/speaker-roster*.ts` writers and the
 * `src/app/api/internal/speakers/**` routes both import, so a route's zod
 * `input` and the mutation it calls can never silently drift.
 */

// Plain `.optional()`, never `.optional().transform(...)`: the transform
// wraps the schema in `ZodEffects`, which `z.infer` no longer recognizes as
// an optional *key* (only an optional *value*) — under `exactOptionalPropertyTypes`
// that turns `firstName?: string` into the much stricter `firstName: string
// | undefined`, which every caller would then have to spread every key to
// satisfy (the exact trap `[eventId]/route.ts`'s `listFiltersSchema` comment
// already documents). An empty-string value is normalized to "not provided"
// in `contactPatchFrom` instead, at the one place that reads it.
const optionalUrl = z.union([z.url(), z.literal("")]).optional();
const optionalText = (max: number) => z.string().trim().max(max).optional();

export const createSpeakerInputSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  firstName: optionalText(120),
  lastName: optionalText(120),
  jobTitle: optionalText(160),
  company: optionalText(160),
  linkedinUrl: optionalUrl,
  twitterUrl: optionalUrl,
  facebookUrl: optionalUrl,
  websiteUrl: optionalUrl,
  workflowStatus: speakerWorkflowStatusSchema.optional(),
});
export type CreateSpeakerInput = z.infer<typeof createSpeakerInputSchema>;

/** Every field independently optional — a caller sends whatever subset it
 * changed, same discipline as the existing PATCH route (M27). */
export const updateSpeakerProfileInputSchema = z.object({
  firstName: z.string().trim().max(120).optional(),
  lastName: z.string().trim().max(120).optional(),
  jobTitle: z.string().trim().max(160).nullable().optional(),
  company: z.string().trim().max(160).nullable().optional(),
  linkedinUrl: z.union([z.url(), z.literal(""), z.null()]).optional(),
  twitterUrl: z.union([z.url(), z.literal(""), z.null()]).optional(),
  facebookUrl: z.union([z.url(), z.literal(""), z.null()]).optional(),
  websiteUrl: z.union([z.url(), z.literal(""), z.null()]).optional(),
  workflowStatus: speakerWorkflowStatusSchema.optional(),
  // Keyed by `LogisticsFieldId`; a present key with an empty string clears
  // that field's value for this contact.
  logisticsValues: z.record(z.string(), z.string().max(2_000)).optional(),
}).refine((input) => Object.keys(input).length > 0, { message: "Provide at least one field to update" });
export type UpdateSpeakerProfileInput = z.infer<typeof updateSpeakerProfileInputSchema>;

export const speakerLogisticsFieldDtoSchema = z.object({
  id: logisticsFieldIdSchema,
  key: z.string(),
  label: z.string(),
  fieldType: speakerLogisticsFieldTypeSchema,
  options: z.array(z.string()),
  sortOrder: z.number().int(),
});
export type SpeakerLogisticsFieldDTO = z.infer<typeof speakerLogisticsFieldDtoSchema>;

export const createLogisticsFieldInputSchema = z.object({
  key: z.string().trim().min(1).max(60).regex(/^[a-z0-9][a-z0-9_]*$/u, "lowercase letters, numbers and underscores only"),
  label: z.string().trim().min(1).max(120),
  fieldType: speakerLogisticsFieldTypeSchema.default("text"),
  options: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
}).refine((input) => input.fieldType !== "select" || input.options.length > 0, {
  message: "A select field needs at least one option",
  path: ["options"],
});
export type CreateLogisticsFieldInput = z.infer<typeof createLogisticsFieldInputSchema>;

export const speakerLogisticsValueDtoSchema = z.object({ fieldId: logisticsFieldIdSchema, value: z.string() });
export type SpeakerLogisticsValueDTO = z.infer<typeof speakerLogisticsValueDtoSchema>;

// --- Unavailability -----------------------------------------------------

export const speakerUnavailabilityDtoSchema = z.object({
  id: unavailabilityIdSchema,
  contactId: contactIdSchema,
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  reason: z.string().nullable(),
});
export type SpeakerUnavailability = z.infer<typeof speakerUnavailabilityDtoSchema>;

export const unavailabilityIntervalInputSchema = z.object({
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  reason: z.string().trim().max(200).optional(),
}).refine((interval) => new Date(interval.endsAt).getTime() > new Date(interval.startsAt).getTime(), {
  message: "End must be after start",
  path: ["endsAt"],
});
export type UnavailabilityIntervalInput = z.infer<typeof unavailabilityIntervalInputSchema>;

export const replaceUnavailabilityInputSchema = z.object({
  intervals: z.array(unavailabilityIntervalInputSchema).max(50),
});
export type ReplaceUnavailabilityInput = z.infer<typeof replaceUnavailabilityInputSchema>;

// --- CSV import ----------------------------------------------------------

export const speakerCsvColumnMappingInputSchema = z.object({
  email: z.number().int().nonnegative(),
  // Partial: an organizer maps whichever columns their spreadsheet has, not
  // all seven every time.
  fields: z.partialRecord(z.enum(SPEAKER_CSV_FIELDS), z.number().int().nonnegative()).default({}),
});
export type SpeakerCsvColumnMapping = z.infer<typeof speakerCsvColumnMappingInputSchema>;

export const importSpeakersCsvInputSchema = z.object({
  csvText: z.string().min(1).max(2_000_000),
  mapping: speakerCsvColumnMappingInputSchema,
  // Preview never writes; commit performs exactly the write the caller's
  // most recent preview described (resolution: CSV import never overwrites a
  // non-empty field silently — see the mutation's docstring for how that is
  // enforced even under a retried commit).
  mode: z.enum(["preview", "commit"]),
});
export type ImportSpeakersCsvInput = z.infer<typeof importSpeakersCsvInputSchema>;

export const speakerCsvRowOutcomeSchema = z.object({
  rowNumber: z.number().int(),
  email: z.string().nullable(),
  status: z.enum(["ok", "duplicate_in_file", "error"]),
  changedFields: z.array(z.string()),
  error: z.string().nullable(),
  // Populated only in commit mode, once the row has actually been written.
  contactId: contactIdSchema.nullable(),
});
export type SpeakerCsvRowOutcome = z.infer<typeof speakerCsvRowOutcomeSchema>;

export const importSpeakersCsvResultSchema = z.object({
  rows: z.array(speakerCsvRowOutcomeSchema),
  valid: z.number().int(),
  invalid: z.number().int(),
  committed: z.number().int(),
});
export type ImportSpeakersCsvResult = z.infer<typeof importSpeakersCsvResultSchema>;

// --- Bulk email ------------------------------------------------------------

export const composeBulkSpeakerEmailInputSchema = z.object({
  // 200, not the roadmap's hypothetical thousands: `<DataTable>` selection is
  // page-local by construction (its own doc comment — "selecting all selects
  // the rows you can see") and this module never adds a "select every match
  // across every page" affordance, so a real browser session can select at
  // most one page's rows. The cap keeps `composeBulkSpeakerEmailIn`'s
  // per-recipient loop (one `speaker_bulk_messages` + one `enqueueEmail`
  // insert each) inside a single request's budget without a bulk-send job
  // queue — the guardrail's "not in a browser request" concern is about the
  // unbounded case this UI cannot reach, not about a bounded page of rows.
  contactIds: z.array(contactIdSchema).min(1).max(200),
  subject: z.string().trim().min(1).max(200),
  bodyHtml: z.string().trim().min(1).max(20_000),
  // "preview" renders the merged content for one recipient and sends
  // nothing; "send" enqueues one email per selected contact.
  mode: z.enum(["preview", "send"]),
  previewContactId: contactIdSchema.optional(),
});
export type ComposeBulkSpeakerEmailInput = z.infer<typeof composeBulkSpeakerEmailInputSchema>;

export const bulkSpeakerEmailPreviewSchema = z.object({
  recipientEmail: z.email(),
  recipientName: z.string(),
  subject: z.string(),
  bodyHtml: z.string(),
});
export type BulkSpeakerEmailPreview = z.infer<typeof bulkSpeakerEmailPreviewSchema>;

export const composeBulkSpeakerEmailResultSchema = z.object({
  queued: z.number().int(),
  skipped: z.number().int(),
  errors: z.array(z.object({ contactId: contactIdSchema, reason: z.string() })),
  preview: bulkSpeakerEmailPreviewSchema.nullable(),
});
export type ComposeBulkSpeakerEmailResult = z.infer<typeof composeBulkSpeakerEmailResultSchema>;

// --- Segmented bulk send (M46) ---------------------------------------------

/**
 * M46 — "bulk segmented sends with preview." No segmentation contract
 * existed yet under M51 (its own bulk-email input takes an explicit
 * `contactIds` array the *caller* already resolved — see
 * `composeBulkSpeakerEmailInputSchema` above), so this is the "simple
 * filter" the roadmap names as the fallback. Deliberately a **separate**
 * contract rather than a change to `composeBulkSpeakerEmailInputSchema`:
 * the existing input/route/mutation are unchanged (no breaking edit to a
 * live export), and a filter resolves to `contactIds` through
 * `resolveSpeakerSegmentIn` (`src/features/comms/server/segments.ts`),
 * which then feeds the untouched M51 compose flow. Both fields are
 * optional and independently combinable (AND, not OR); an entirely empty
 * filter matches every contact in the event.
 */
export const speakerSegmentFilterSchema = z.object({
  workflowStatus: z.array(speakerWorkflowStatusSchema).min(1).optional(),
  confirmationStatus: z.array(confirmationStatusSchema).min(1).optional(),
});
export type SpeakerSegmentFilter = z.infer<typeof speakerSegmentFilterSchema>;

export const resolvedSpeakerSegmentRecipientSchema = z.object({
  contactId: contactIdSchema,
  email: z.email(),
  name: z.string(),
});
export type ResolvedSpeakerSegmentRecipient = z.infer<typeof resolvedSpeakerSegmentRecipientSchema>;

/**
 * `matchedCount` is every contact the filter alone selects — the segment's
 * true size, for organizer-facing "N speakers match" copy. `contactIds` is
 * the mailable subset: matched, minus suppressed, minus unsubscribed (the
 * same two checks `composeBulkSpeakerEmailIn` re-runs at send time — this
 * is a preview of that outcome, not a replacement for it), capped at this
 * segment's own 2,000-recipient ceiling — a *different, larger* number than
 * `composeBulkSpeakerEmailInputSchema`'s own `contactIds` cap (200, a
 * browser DataTable-selection limit, see that schema's comment above). A
 * resolved list above 200 is therefore not a valid single `contactIds`
 * input on its own; the caller (`BulkSendTab`, via `use-bulk-send.ts`'s
 * `chunkContactIds`/`mergeBulkSendResults`) sends it as multiple compose
 * calls. `preview` is a short, human-readable sample (never the full list)
 * for a "who am I about to email" sanity check in the UI.
 */
export const resolvedSpeakerSegmentSchema = z.object({
  matchedCount: z.number().int().nonnegative(),
  contactIds: z.array(contactIdSchema).max(2_000),
  capped: z.boolean(),
  excludedSuppressedCount: z.number().int().nonnegative(),
  excludedUnsubscribedCount: z.number().int().nonnegative(),
  preview: z.array(resolvedSpeakerSegmentRecipientSchema).max(50),
});
export type ResolvedSpeakerSegment = z.infer<typeof resolvedSpeakerSegmentSchema>;

// --- Uploaded assets (organizer-visible speaker uploads) -------------------

export const speakerUploadDtoSchema = z.object({
  fileId: z.string(),
  filename: z.string(),
  mime: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  requestTitle: z.string(),
  uploaderLabel: z.string(),
  createdAt: z.iso.datetime(),
});
export type SpeakerUploadDTO = z.infer<typeof speakerUploadDtoSchema>;
