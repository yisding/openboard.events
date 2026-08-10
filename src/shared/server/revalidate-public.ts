import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { events } from "@/db/schema";
import type { CanonicalEmbedContentType } from "@/features/public/embed-config-types";
import type { EventId } from "@/shared/contracts";
import { log } from "@/shared/lib/log";

/**
 * Drop the ISR entries for an event's public surfaces.
 *
 * Every public page is cached for 60 seconds. That window is invisible to a
 * visitor but very visible to the organizer who just published a session and
 * reloaded the public page to check it, so a write that changes what those
 * pages show asks for them back.
 *
 * Cache invalidation is never allowed to fail the write that triggered it: the
 * database already committed, and an organizer must not see an error for a
 * change that landed. A failure here only means the page refreshes on its own
 * schedule instead.
 */
export type PublicEventSurface = "schedule" | "speakers";

/**
 * What a caller means, mapped to the routes that actually render it.
 *
 * Callers name the *data* they changed, not a URL, because the URLs moved and
 * will move again: M53 split the single `/e/[slug]/schedule` page into five
 * surfaces, leaving `/schedule` a bare `redirect()` to `/agenda` with no
 * `export const revalidate` at all. Revalidating that path therefore dropped
 * nothing, and every page that really shows sessions kept serving stale HTML
 * for the full 60 s window — the exact latency this module exists to remove.
 * Keeping the fan-out here means one place to update the next time the public
 * routes are rearranged.
 */
const SURFACE_ROUTES: Record<PublicEventSurface, readonly string[]> = {
  // Everything rendered from `getPublishedSchedule`.
  schedule: ["agenda", "sessions", "itinerary"],
  // Everything rendered from `getPublishedSpeakers`. `published_speakers_v` is
  // derived from published sessions, so a session write moves this too — which
  // is why the session routes ask for both surfaces.
  speakers: ["speakers", "gallery"],
};

/**
 * M53's `/embed/**` routes share the exact same `route` segments and read
 * from the exact same `getPublishedSchedule`/`getPublishedSpeakers` queries
 * as their `/e/**` counterparts (the "one component/data contract" guardrail)
 * — so a session/speaker write that goes stale on one goes stale on the
 * other. `/embed/**` only started needing this call once it became
 * `revalidate = 60` itself (the caching-regression fix, status.md rev. 11);
 * while it read `searchParams` it was never cached in the first place.
 */
export async function revalidatePublicEvent(eventId: EventId, surfaces: readonly PublicEventSurface[], requestId: string): Promise<void> {
  try {
    const [event] = await db.select({ slug: events.slug }).from(events).where(eq(events.id, eventId)).limit(1);
    if (!event) return;
    // De-duplicated: `["schedule", "speakers"]` is the common call and the two
    // fan-outs must not revalidate a shared route twice.
    const routes = new Set(surfaces.flatMap((surface) => SURFACE_ROUTES[surface]));
    for (const route of routes) {
      revalidatePath(`/e/${event.slug}/${route}`);
      revalidatePath(`/embed/${event.slug}/${route}`);
    }
  } catch {
    log({ level: "warn", msg: "revalidate.failed", requestId, feature: "cache", eventId });
  }
}

/**
 * A saved embed config (kill switch, style, or content filters) only ever
 * affects its own `/embed/[slug]/<route>` page — never the direct `/e/**`
 * page, which never reads the config at all — so this is deliberately
 * narrower than `revalidatePublicEvent` above rather than a call into it.
 */
const EMBED_CONTENT_TYPE_ROUTE: Record<CanonicalEmbedContentType, string> = {
  session_list: "sessions",
  agenda: "agenda",
  schedule_itinerary: "itinerary",
  speaker_list: "speakers",
  speaker_gallery: "gallery",
};

export async function revalidatePublicEmbed(eventId: EventId, contentType: CanonicalEmbedContentType, requestId: string): Promise<void> {
  try {
    const [event] = await db.select({ slug: events.slug }).from(events).where(eq(events.id, eventId)).limit(1);
    if (!event) return;
    revalidatePath(`/embed/${event.slug}/${EMBED_CONTENT_TYPE_ROUTE[contentType]}`);
  } catch {
    log({ level: "warn", msg: "revalidate.failed", requestId, feature: "cache", eventId });
  }
}
