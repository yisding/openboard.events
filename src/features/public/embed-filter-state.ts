import type { EmbedFilters } from "./embed-config-types";

export type EmbedFilterVocabulary = {
  trackIds: ReadonlySet<string>;
  formatIds: ReadonlySet<string>;
  roomIds: ReadonlySet<string>;
};

/** Remove vocabulary ids that no longer exist while preserving field-visibility
 * settings. Empty arrays deliberately mean the same thing as no filter. */
export function sanitizeEmbedFilters(filters: EmbedFilters, vocabulary: EmbedFilterVocabulary): EmbedFilters {
  return {
    ...filters,
    ...(filters.trackIds ? { trackIds: filters.trackIds.filter((id) => vocabulary.trackIds.has(id)) } : {}),
    ...(filters.formatIds ? { formatIds: filters.formatIds.filter((id) => vocabulary.formatIds.has(id)) } : {}),
    ...(filters.roomIds ? { roomIds: filters.roomIds.filter((id) => vocabulary.roomIds.has(id)) } : {}),
  };
}
