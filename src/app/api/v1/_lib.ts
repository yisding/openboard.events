import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { events } from "@/db/schema";
import { initialDemoState } from "@/shared/demo/seed";
import { isCredentialFreeLocalDemo } from "@/shared/lib/env";

// Public DTO responses are shared-cacheable; private responses must never enter
// a shared cache and retain CORS headers for the future scoped-key integration.
export const publicHeaders = { "access-control-allow-origin": "*", "cache-control": "public, s-maxage=60, stale-while-revalidate=300" };
export const privateHeaders = { "access-control-allow-origin": "*", "cache-control": "private, no-store" };

export function corsPreflight() {
  return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, OPTIONS", "access-control-allow-headers": "authorization, content-type", "access-control-max-age": "86400" } });
}

export function data<T>(value: T, meta?: Record<string, unknown>) {
  return Response.json({ data: value, ...(meta ? { meta } : {}) }, { headers: publicHeaders });
}
export function privateApiUnavailable() {
  return Response.json(
    { error: { code: "FEATURE_UNAVAILABLE", message: "Private API access is not enabled" } },
    { status: 503, headers: privateHeaders },
  );
}
export function notFoundResponse() {
  return Response.json({ error: { code: "NOT_FOUND", message: "Event not found" } }, { status: 404, headers: privateHeaders });
}
export function resolveEvent(slug: string) {
  return initialDemoState.events.find((item) => item.slug === slug);
}

export type PublicEvent = {
  id: string;
  slug: string;
  name: string;
  websiteUrl: string | null;
  timezone: string;
  location: string | null;
  startsAt: Date | string;
  endsAt: Date | string;
};

export function publicEventDto(event: PublicEvent) {
  return {
    id: event.id,
    slug: event.slug,
    name: event.name,
    websiteUrl: event.websiteUrl,
    timezone: event.timezone,
    location: event.location,
    startsAt: new Date(event.startsAt).toISOString(),
    endsAt: new Date(event.endsAt).toISOString(),
  };
}

/**
 * The public API answers about a real event unless there is no database at all.
 * Falling back to the fixture whenever a lookup misses would let the API claim
 * an event exists that a judge cannot find anywhere else.
 */
export async function resolvePublicEvent(slug: string): Promise<PublicEvent | null> {
  if (isCredentialFreeLocalDemo()) {
    const demo = resolveEvent(slug);
    return demo ? {
      id: demo.id,
      slug: demo.slug,
      name: demo.name,
      websiteUrl: null,
      timezone: demo.timezone,
      location: demo.venue || demo.city || null,
      startsAt: demo.startsAt,
      endsAt: demo.endsAt,
    } : null;
  }
  const [row] = await db
    .select({
      id: events.id,
      slug: events.slug,
      name: events.name,
      websiteUrl: events.websiteUrl,
      timezone: events.timezone,
      location: events.location,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
    })
    .from(events)
    .where(eq(events.slug, slug))
    .limit(1);
  return row ?? null;
}
