import { unstable_cache } from "next/cache";
import type { EventId } from "@/shared/contracts";
import {
  PUBLIC_CACHE_RECOVERY_SECONDS,
  publicCacheTagsFor,
  type PublicCacheSurface,
} from "../cache-contract";

/**
 * Cache one event-scoped public read and attach the domain tags consumed by
 * every canonical and embed route that calls it. The event id and semantic
 * surface form the key; route spellings never do.
 */
export function cachePublicRead<Result>(
  eventId: EventId,
  surface: PublicCacheSurface,
  load: () => Promise<Result>,
): Promise<Result> {
  return unstable_cache(load, ["openboard-public", eventId, surface], {
    revalidate: PUBLIC_CACHE_RECOVERY_SECONDS,
    tags: publicCacheTagsFor(eventId, surface),
  })();
}
