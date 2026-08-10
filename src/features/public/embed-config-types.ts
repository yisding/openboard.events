import { z } from "zod";
import { embedIdSchema, eventIdSchema, type EmbedId, type EventId } from "@/shared/contracts";

/**
 * `embeds` (see `drizzle/0000_init.sql`) carries five `embed_content_type`
 * values, but M33 only ever configures the two the bare-shell routes serve.
 * M53 is scoped to widen this to the remaining three plus filters.
 */
export const CANONICAL_EMBED_TYPES = ["schedule_itinerary", "speaker_gallery"] as const;
export const canonicalEmbedContentTypeSchema = z.enum(CANONICAL_EMBED_TYPES);
export type CanonicalEmbedContentType = z.infer<typeof canonicalEmbedContentTypeSchema>;

export const embedStyleSchema = z.object({
  accent: z.string().trim().min(1).max(32).optional(),
  theme: z.enum(["light", "dark"]).optional(),
  showHeader: z.boolean().optional(),
});
export type EmbedStyle = z.infer<typeof embedStyleSchema>;

export const embedConfigDtoSchema = z.object({
  id: embedIdSchema,
  eventId: eventIdSchema,
  contentType: canonicalEmbedContentTypeSchema,
  enabled: z.boolean(),
  style: embedStyleSchema,
});
export type EmbedConfigDTO = z.infer<typeof embedConfigDtoSchema>;

export const embedConfigPatchSchema = z.object({
  enabled: z.boolean().optional(),
  style: embedStyleSchema.optional(),
});
export type EmbedConfigPatch = z.infer<typeof embedConfigPatchSchema>;

// Kept here (no `@/db/client` import) so client components can share the
// wire shape without pulling server-only code into the browser bundle —
// same seam as `features/submissions/evaluation/types.ts`.
export type { EmbedId, EventId };
