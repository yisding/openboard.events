import { revalidateTag } from "next/cache";
import type { EventId } from "@/shared/contracts";
import { log } from "@/shared/lib/log";
import type { CanonicalEmbedContentType } from "../embed-config-types";
import {
  publicCacheTag,
  publicEventSurfaceForEmbed,
  type PublicEventSurface,
} from "../cache-contract";

function revalidate(tags: readonly string[]): void {
  for (const tag of new Set(tags)) revalidateTag(tag);
}

/**
 * Emit semantic invalidations after a committed write. Failures never turn a
 * successful mutation into an error; time-based revalidation remains the
 * bounded recovery path.
 */
export async function revalidatePublicEvent(
  eventId: EventId,
  surfaces: readonly PublicEventSurface[],
  requestId: string,
): Promise<void> {
  try {
    revalidate(surfaces.map((surface) => publicCacheTag[surface](eventId)));
  } catch {
    log({ level: "warn", msg: "revalidate.failed", requestId, feature: "cache", eventId });
  }
}

/** Event name, slug, timezone, dates, theme, logo, or background changed. */
export async function revalidatePublicEventMetadata(eventId: EventId, requestId: string): Promise<void> {
  try {
    revalidate([publicCacheTag.event(eventId)]);
  } catch {
    log({ level: "warn", msg: "revalidate.failed", requestId, feature: "cache", eventId });
  }
}

/**
 * A kill switch, style, or filter affects one canonical embed type. The
 * paired content tag is also an eviction anchor for the composed ISR document:
 * deployed OpenNext cache proof showed that expiring an independently cached
 * config read alone does not evict an already-rendered embed page.
 */
export async function revalidatePublicEmbed(
  eventId: EventId,
  contentType: CanonicalEmbedContentType,
  requestId: string,
): Promise<void> {
  try {
    const contentSurface = publicEventSurfaceForEmbed(contentType);
    revalidate([
      publicCacheTag.embed(eventId, contentType),
      publicCacheTag[contentSurface](eventId),
    ]);
  } catch {
    log({ level: "warn", msg: "revalidate.failed", requestId, feature: "cache", eventId });
  }
}
