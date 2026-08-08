import { initialDemoState } from "@/shared/demo/seed";
import { getEnv } from "@/shared/lib/env";

// Public DTO responses are shared-cacheable; keyed responses must never enter
// a shared cache (private, no-store) but still need CORS headers so browser
// integrations holding a key can call them cross-origin.
export const publicHeaders = { "access-control-allow-origin": "*", "cache-control": "public, s-maxage=60, stale-while-revalidate=300" };
export const privateHeaders = { "access-control-allow-origin": "*", "cache-control": "private, no-store" };

export function corsPreflight() {
  return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, OPTIONS", "access-control-allow-headers": "authorization, content-type", "access-control-max-age": "86400" } });
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
export function resolveEvent(slug: string) {
  return initialDemoState.events.find((item) => item.slug === slug);
}

function safeEqual(left: string, right: string) {
  const length = Math.max(left.length, right.length);
  let mismatch = left.length === right.length ? 0 : 1;
  for (let index = 0; index < length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

// Demo mode: one environment-scoped key. Hashed per-event api_keys (see the
// api_keys table) take over when the database lands.
export function authorize(request: Request) {
  const key = getEnv().OPENBOARD_API_KEY;
  return Boolean(key) && safeEqual(request.headers.get("authorization") ?? "", `Bearer ${key}`);
}
