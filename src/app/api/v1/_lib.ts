import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/db/client";
import { events } from "@/db/schema";
import { apiErrorSchema } from "@/shared/contracts";
import { initialDemoState } from "@/shared/demo/seed";
import { isCredentialFreeLocalDemo } from "@/shared/lib/env";
import { AppError, isAppError, toHttp } from "@/shared/lib/errors";
import { checkRateLimit, clientIp } from "@/shared/server/rate-limit";
import type { AuthSession } from "@/shared/server/handler";

// Public DTO responses are shared-cacheable; private (keyed) responses must
// never enter a shared cache. Both carry permissive CORS — `/api/v1/*` is the
// one surface in this app meant to be called from another origin (embeds,
// judge scripts); `/api/internal/*` never gets this treatment.
export const publicHeaders = { "access-control-allow-origin": "*", "cache-control": "public, s-maxage=60, stale-while-revalidate=300" };
export const privateHeaders = { "access-control-allow-origin": "*", "cache-control": "private, no-store" };

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
 * (unauthenticated public DTOs). A no-op under `isCredentialFreeLocalDemo()`
 * — that mode's whole point is answering from the in-memory fixture with no
 * `DATABASE_URL` at all, and `checkRateLimit` unconditionally queries `db`.
 */
export function checkV1RateLimit(bucket: string, request: NextRequest | Request): Promise<void> {
  if (isCredentialFreeLocalDemo()) return Promise.resolve();
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
 * This mirrors `defineHandler`'s own catch block (same error envelope, same
 * status mapping) for the one route that has to construct its response by
 * hand, the same justified exception `export.csv/route.ts` documents for its
 * own non-JSON body.
 */
export function apiV1ErrorResponse(error: unknown): Response {
  const appError = isAppError(error)
    ? error
    : error instanceof z.ZodError
      ? new AppError("VALIDATION", "Request validation failed")
      : new AppError("INTERNAL", "Unexpected server error");
  const envelope = apiErrorSchema.parse({ error: { code: appError.code, message: appError.message, data: appError.details } });
  return Response.json(envelope, { status: toHttp(appError.code), headers: privateHeaders });
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
