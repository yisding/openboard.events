import { z } from "zod";
import { EMBED_CONTENT_TYPES, embedContentTypeSchema, embedIdSchema, eventIdSchema, type EmbedId, type EventId } from "@/shared/contracts";

/**
 * `embeds` (see `drizzle/0000_init.sql`) carries all five `embed_content_type`
 * values — one per M53 public surface (agenda, session_list,
 * schedule_itinerary, speaker_list, speaker_gallery), defined once in
 * `shared/contracts/enums.ts`. M33 only ever configured the two the
 * bare-shell routes served; M53 widens this to all five plus content filters
 * and field visibility. "Canonical" here just means "the one enum this app
 * has" — kept as an alias so this module's history (and every import site)
 * doesn't need renaming now that it covers the whole set.
 */
export const CANONICAL_EMBED_TYPES = EMBED_CONTENT_TYPES;
export const canonicalEmbedContentTypeSchema = embedContentTypeSchema;
export type CanonicalEmbedContentType = z.infer<typeof canonicalEmbedContentTypeSchema>;

export const embedStyleSchema = z.object({
  accent: z.string().trim().min(1).max(32).optional(),
  theme: z.enum(["light", "dark"]).optional(),
  showHeader: z.boolean().optional(),
});
export type EmbedStyle = z.infer<typeof embedStyleSchema>;

/**
 * Which fields render on the two speaker-identity surfaces. All default to
 * shown (`true`) when absent — an unconfigured embed shows everything the
 * direct page shows, per the M53 guardrail that embeds and direct pages
 * share one component/data contract.
 */
export const embedFieldVisibilitySchema = z.object({
  description: z.boolean().optional(),
  speakerCompany: z.boolean().optional(),
  speakerBio: z.boolean().optional(),
});
export type EmbedFieldVisibility = z.infer<typeof embedFieldVisibilitySchema>;

/**
 * Content filters, scoped by id against the event's own tracks/formats/rooms
 * — an empty/absent array means "no filter, show everything". Session-shaped
 * surfaces (agenda, session_list, schedule_itinerary) apply all three;
 * speaker-shaped surfaces (speaker_list, speaker_gallery) apply none of the
 * id filters and only ever read `fields`.
 */
export const embedFiltersSchema = z.object({
  trackIds: z.array(z.string()).optional(),
  formatIds: z.array(z.string()).optional(),
  roomIds: z.array(z.string()).optional(),
  fields: embedFieldVisibilitySchema.optional(),
});
export type EmbedFilters = z.infer<typeof embedFiltersSchema>;

export const embedConfigDtoSchema = z.object({
  id: embedIdSchema,
  eventId: eventIdSchema,
  contentType: canonicalEmbedContentTypeSchema,
  enabled: z.boolean(),
  style: embedStyleSchema,
  filters: embedFiltersSchema,
});
export type EmbedConfigDTO = z.infer<typeof embedConfigDtoSchema>;

export const embedConfigPatchSchema = z.object({
  enabled: z.boolean().optional(),
  style: embedStyleSchema.optional(),
  filters: embedFiltersSchema.optional(),
});
export type EmbedConfigPatch = z.infer<typeof embedConfigPatchSchema>;

// Kept here (no `@/db/client` import) so client components can share the
// wire shape without pulling server-only code into the browser bundle —
// same seam as `features/submissions/evaluation/types.ts`.
export type { EmbedId, EventId };
