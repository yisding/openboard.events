import type { EventId } from "@/shared/contracts";
import type { CanonicalEmbedContentType } from "./embed-config-types";

/**
 * Public reads recover from a lost invalidation within one minute. Mutations
 * are expected to become visible across Worker isolates within ten seconds;
 * the deployed cache proof enforces that tighter, normal-operation budget.
 */
export const PUBLIC_CACHE_RECOVERY_SECONDS = 60;
export const PUBLIC_CACHE_MUTATION_BUDGET_SECONDS = 10;

export type PublicEventSurface = "schedule" | "speakers";
export type PublicCacheSurface = PublicEventSurface | `embed:${CanonicalEmbedContentType}`;

export function publicEventSurfaceForEmbed(
  contentType: CanonicalEmbedContentType,
): PublicEventSurface {
  return contentType === "speaker_list" || contentType === "speaker_gallery"
    ? "speakers"
    : "schedule";
}

const prefix = (eventId: EventId) => `public:event:${eventId}`;

/** Stable domain tags. URLs and route aliases deliberately do not appear. */
export const publicCacheTag = {
  event: (eventId: EventId) => `${prefix(eventId)}:metadata`,
  schedule: (eventId: EventId) => `${prefix(eventId)}:schedule`,
  speakers: (eventId: EventId) => `${prefix(eventId)}:speakers`,
  embed: (eventId: EventId, contentType: CanonicalEmbedContentType) =>
    `${prefix(eventId)}:embed:${contentType}`,
};

export function publicCacheTagsFor(eventId: EventId, surface: PublicCacheSurface): string[] {
  if (surface.startsWith("embed:")) {
    const contentType = surface.slice("embed:".length) as CanonicalEmbedContentType;
    const tags = [publicCacheTag.event(eventId), publicCacheTag.embed(eventId, contentType)];
    // Until the admin panel materializes a canonical speaker_list row, that
    // public read inherits speaker_gallery. Keep the dependency explicit so
    // an already-open legacy admin client invalidates both cached consumers.
    if (contentType === "speaker_list") tags.push(publicCacheTag.embed(eventId, "speaker_gallery"));
    return tags;
  }
  const dataSurface = surface as PublicEventSurface;
  return [publicCacheTag.event(eventId), publicCacheTag[dataSurface](eventId)];
}
