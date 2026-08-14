import { revalidateTag } from "next/cache";
import type { EventId } from "@/shared/contracts";
import { log } from "@/shared/lib/log";
import type { CanonicalEmbedContentType } from "../embed-config-types";
import { publicCacheTag, type PublicEventSurface } from "../cache-contract";

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

/** A kill switch, style, or filter affects only its canonical embed type. */
export async function revalidatePublicEmbed(
  eventId: EventId,
  contentType: CanonicalEmbedContentType,
  requestId: string,
): Promise<void> {
  try {
    revalidate([publicCacheTag.embed(eventId, contentType)]);
  } catch {
    log({ level: "warn", msg: "revalidate.failed", requestId, feature: "cache", eventId });
  }
}
