import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db } from "@/db/client";
import { events } from "@/db/schema";
import { checkRateLimit, clientIp } from "@/shared/server/rate-limit";
import { errorEnvelope, type AuthSession } from "@/shared/server/handler";

// Public DTO responses are shared-cacheable; private (keyed) responses must
// never enter a shared cache. Both carry permissive CORS — `/api/v1/*` is the
// one surface in this app meant to be called from another origin (embeds,
// judge scripts); `/api/internal/*` never gets this treatment.
const publicHeaders = { "access-control-allow-origin": "*", "cache-control": "public, s-maxage=60, stale-while-revalidate=300" };
const privateHeaders = { "access-control-allow-origin": "*", "cache-control": "private, no-store" };

export function corsPreflight() {
  return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, OPTIONS", "access-control-allow-headers": "authorization, content-type", "access-control-max-age": "86400" } });
}

/**
 * `/api/v1` rate-limit config (PLAN P3-SEC), one bucket per route so a burst
 * on one endpoint cannot starve another's budget. Keyed on the resolved API
 * key id when the route is keyed (`apiKeyAuth`'s `session.actorId`); falls
 * back to the caller's IP for the three unauthenticated public DTO routes
 * (`events/[slug]`, `schedule`, `speakers`), which have no key to key on.
 */
export function v1RateLimit(bucket: string) {
  return {
    limit: 300,
    windowMs: 5 * 60 * 1000,
    key: ({ session, request }: { session: AuthSession; request: NextRequest }) => `v1:${bucket}:${session?.actorId ?? clientIp(request)}`,
  };
}

/**
 * Manual call for the three `/api/v1` routes built without `defineHandler`
 * (unauthenticated public DTOs). Keyed on the caller's IP — those routes have
 * no API key to key on.
 */
export function checkV1RateLimit(bucket: string, request: NextRequest | Request): Promise<void> {
  return checkRateLimit(db, { key: `v1:${bucket}:${clientIp(request)}`, limit: 300, windowMs: 5 * 60 * 1000 });
}

export function data<T>(value: T, meta?: Record<string, unknown>) {
  return Response.json({ data: value, ...(meta ? { meta } : {}) }, { headers: publicHeaders });
}
export function privateData<T>(value: T, meta?: Record<string, unknown>) {
  return Response.json({ data: value, ...(meta ? { meta } : {}) }, { headers: privateHeaders });
}
export function notFoundResponse() {
  return Response.json({ error: { code: "NOT_FOUND", message: "Event not found" } }, { status: 404, headers: privateHeaders });
}

/**
 * The four keyed routes are built on `defineHandler` (shared guard/validation/
 * error-envelope machinery), which always answers `{ data }` with no headers
 * of its own. This stamps the CORS + `private, no-store` headers `/api/v1`
 * promises on top of that response, after the fact, without forking
 * `defineHandler` itself (owned elsewhere) just for two header lines.
 */
export function withV1PrivateHeaders(response: Response): Response {
  for (const [key, value] of Object.entries(privateHeaders)) response.headers.set(key, value);
  return response;
}

/**
 * `/submissions` needs a bare-array `data` *and* a sibling `meta.nextCursor` —
 * a shape `defineHandler` cannot express (it only ever answers `{ data }`).
 * The public DTO routes likewise build their own responses. All of them route
 * failures through `defineHandler`'s own `errorEnvelope`, so a 500 on the
 * public API is captured and alertable rather than logged nowhere.
 */
export function apiV1ErrorResponse(error: unknown, request?: Request): Response {
  const { envelope, status } = errorEnvelope(error, {
    requestId: request?.headers.get("cf-ray") ?? crypto.randomUUID(),
    feature: "api-v1",
  });
  return Response.json(envelope, { status, headers: privateHeaders });
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
  // First Fair (design §5.1) — additive: `/api/v1`'s response contract is
  // unchanged for everything else in this PR. A judge script or integration
  // that does not know this field exists keeps working exactly as before;
  // one that does can filter a demo event out for itself. Default-filtering
  // it out of every `/api/v1` result set is a stated follow-on, not this PR.
  isDemo: boolean;
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
    isDemo: event.isDemo,
  };
}

/**
 * The public API only ever answers about a real event: an unknown slug is a
 * `null` here and a 404 at the edge, never a synthesized stand-in that claims
 * an event exists which a judge cannot find anywhere else.
 */
export async function resolvePublicEvent(slug: string): Promise<PublicEvent | null> {
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
      isDemo: events.isDemo,
    })
    .from(events)
    .where(eq(events.slug, slug))
    .limit(1);
  return row ?? null;
}
