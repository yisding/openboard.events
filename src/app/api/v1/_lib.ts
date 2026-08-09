import { initialDemoState } from "@/shared/demo/seed";

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
