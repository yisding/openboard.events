import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { eventIdSchema } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { defineHandler, errorEnvelope, routeIdentity } from "./handler";
import * as rateLimitModule from "./rate-limit";

const publicGuard = async () => null;

describe("defineHandler", () => {
  it("accepts a bodyless DELETE as an empty object", async () => {
    const route = defineHandler({
      auth: publicGuard,
      input: z.object({}),
      handler: async ({ input }) => input,
    });
    const response = await route(new NextRequest("https://example.test/resource", { method: "DELETE" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: {} });
  });

  it("reports malformed JSON as a validation error", async () => {
    const route = defineHandler({ auth: publicGuard, input: z.object({}), handler: async () => ({}) });
    const response = await route(new NextRequest("https://example.test/resource", { method: "POST", body: "{" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "VALIDATION", message: "Request body must be valid JSON" } });
  });

  it("preserves repeated query parameters as arrays", async () => {
    const route = defineHandler({
      auth: publicGuard,
      input: z.object({ tag: z.array(z.string()) }),
      handler: async ({ input }) => input,
    });
    const response = await route(new NextRequest("https://example.test/resource?tag=agents&tag=safety"));
    expect(await response.json()).toEqual({ data: { tag: ["agents", "safety"] } });
  });

  it("puts normalized Zod errors on error.fieldErrors", async () => {
    const route = defineHandler({ auth: publicGuard, input: z.object({ page: z.coerce.number().int() }), handler: async () => ({}) });
    const response = await route(new NextRequest("https://example.test/resource?page=nope"));
    const payload = await response.json();
    expect(response.status).toBe(400);
    expect(payload.error.fieldErrors.page).toEqual(expect.any(String));
    expect(payload.error.data).toBeUndefined();
  });

  it("retains AppError details as error.data", async () => {
    const route = defineHandler({
      auth: publicGuard,
      input: z.object({}),
      handler: async () => { throw new AppError("CONFLICT", "Already exists", { id: "duplicate" }); },
    });
    const response = await route(new NextRequest("https://example.test/resource"));
    expect(await response.json()).toEqual({ error: { code: "CONFLICT", message: "Already exists", data: { id: "duplicate" } } });
  });

  it("serializes AppError field errors independently from diagnostic details", async () => {
    const route = defineHandler({
      auth: publicGuard,
      input: z.object({}),
      handler: async () => {
        throw new AppError("VALIDATION", "That URL is already used", { constraint: "resource_pages_event_slug_unique" }, { slug: "That URL is already used" });
      },
    });
    const response = await route(new NextRequest("https://example.test/resource"));
    expect(await response.json()).toEqual({
      error: {
        code: "VALIDATION",
        message: "That URL is already used",
        data: { constraint: "resource_pages_event_slug_unique" },
        fieldErrors: { slug: "That URL is already used" },
      },
    });
  });

  it("passes route params to auth and adopts its resolved event", async () => {
    const eventId = eventIdSchema.parse("a0000000-0000-4000-8000-000000000001");
    const route = defineHandler({
      auth: async (_request, unresolvedEventId, params) => {
        expect(unresolvedEventId).toBeNull();
        expect(params.slug).toBe("auth-a");
        return { actorId: "api-key", role: "api_key", eventId };
      },
      input: z.object({}),
      handler: async ({ eventId: resolvedEventId, params }) => ({ eventId: resolvedEventId, slug: params.slug }),
    });
    const response = await route(new NextRequest("https://example.test/resource"), { params: Promise.resolve({ slug: "auth-a" }) });
    expect(await response.json()).toEqual({ data: { eventId, slug: "auth-a" } });
  });
});

describe("defineHandler origin check (CSRF, PLAN P3-SEC)", () => {
  const route = defineHandler({ auth: publicGuard, input: z.object({}), handler: async () => ({ ok: true }) });

  it("allows a mutating request with no Origin/Referer (non-browser callers, e.g. a test harness's HTTP client)", async () => {
    const response = await route(new NextRequest("https://example.test/resource", { method: "POST" }));
    expect(response.status).toBe(200);
  });

  it("allows a same-origin POST that carries a matching Origin header", async () => {
    const response = await route(new NextRequest("https://example.test/resource", {
      method: "POST",
      headers: { origin: "https://example.test" },
    }));
    expect(response.status).toBe(200);
  });

  it("rejects a cross-site POST with a mismatched Origin as FORBIDDEN", async () => {
    const response = await route(new NextRequest("https://example.test/resource", {
      method: "POST",
      headers: { origin: "https://evil.test" },
    }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "FORBIDDEN", message: "Cross-origin request rejected" } });
  });

  it("falls back to Referer when Origin is absent, and still rejects a mismatch", async () => {
    const response = await route(new NextRequest("https://example.test/resource", {
      method: "POST",
      headers: { referer: "https://evil.test/attack-page" },
    }));
    expect(response.status).toBe(403);
  });

  it("never checks the origin on a GET", async () => {
    const response = await route(new NextRequest("https://example.test/resource?", {
      headers: { origin: "https://evil.test" },
    }));
    expect(response.status).toBe(200);
  });

  it("exempts a guard marked csrfExempt (apiKeyAuth's own contract)", async () => {
    const exemptGuard = Object.assign(async () => null, { csrfExempt: true });
    const exemptRoute = defineHandler({ auth: exemptGuard, input: z.object({}), handler: async () => ({ ok: true }) });
    const response = await exemptRoute(new NextRequest("https://example.test/resource", {
      method: "POST",
      headers: { origin: "https://evil.test" },
    }));
    expect(response.status).toBe(200);
  });
});

describe("defineHandler error-tracking seam (PLAN P3-OPS release-gate item 5)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("captures the raw error's message and stack for an unmapped throw, while the wire response stays generic", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const route = defineHandler({
      auth: publicGuard,
      input: z.object({}),
      handler: async () => { throw new Error("db pool exhausted"); },
    });
    const response = await route(new NextRequest("https://example.test/resource"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: "INTERNAL", message: "Unexpected server error" } });
    const captured = JSON.parse(spy.mock.calls[0]?.[0] as string);
    expect(captured).toMatchObject({ level: "error", msg: "error.captured", code: "INTERNAL", error: "db pool exhausted" });
    expect(captured.stack).toContain("db pool exhausted");
    // Both halves of one failure belong in the same stream: the capture that
    // carries the real message and the request line that carries the timing.
    expect(JSON.parse(spy.mock.calls[1]?.[0] as string)).toMatchObject({ level: "error", msg: "request.failed", code: "INTERNAL" });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("captures an AppError explicitly thrown with code INTERNAL, keeping its real message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const route = defineHandler({
      auth: publicGuard,
      input: z.object({}),
      handler: async () => { throw new AppError("INTERNAL", "R2 credentials are not configured"); },
    });
    await route(new NextRequest("https://example.test/resource"));

    const captured = JSON.parse(spy.mock.calls[0]?.[0] as string);
    expect(captured.error).toBe("R2 credentials are not configured");
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("captures and maps for a route that cannot use defineHandler", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { envelope, status } = errorEnvelope(new Error("R2 unreachable"), { requestId: "ray-9", feature: "api-v1" });

    expect(status).toBe(500);
    expect(envelope).toEqual({ error: { code: "INTERNAL", message: "Unexpected server error" } });
    // The whole point of the shared seam: a 500 on a hand-rolled route reaches
    // `operational_errors` instead of being logged nowhere.
    expect(JSON.parse(spy.mock.calls[0]?.[0] as string)).toMatchObject({
      msg: "error.captured",
      feature: "api-v1",
      error: "R2 unreachable",
    });
  });

  it("maps a ZodError to a 400 with field errors, and lets a route override the copy", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const zodError = await z.object({ code: z.string() }).safeParseAsync({});
    if (zodError.success) throw new Error("test setup: expected a parse failure");

    const generic = errorEnvelope(zodError.error, { requestId: "ray-1", feature: "uploads" });
    expect(generic.status).toBe(400);
    expect(generic.envelope.error.code).toBe("VALIDATION");
    expect(generic.envelope.error.fieldErrors?.code).toEqual(expect.any(String));

    const portal = errorEnvelope(zodError.error, {
      requestId: "ray-2",
      feature: "portal-auth",
      fallbackMessages: { validation: "Enter a valid code" },
    });
    expect(portal.envelope.error.message).toBe("Enter a valid code");
    expect(portal.status).toBe(400);
  });

  it("does not capture an expected AppError (VALIDATION/CONFLICT/etc.)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const route = defineHandler({
      auth: publicGuard,
      input: z.object({}),
      handler: async () => { throw new AppError("CONFLICT", "Already exists"); },
    });
    await route(new NextRequest("https://example.test/resource"));
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("defineHandler rate limiting (PLAN P3-SEC)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("still 429s a genuine RATE_LIMITED rejection from the limiter", async () => {
    vi.spyOn(rateLimitModule, "checkRateLimit").mockRejectedValue(new AppError("RATE_LIMITED", "Too many requests. Please try again shortly."));
    const route = defineHandler({
      auth: publicGuard,
      input: z.object({}),
      rateLimit: { limit: 1, windowMs: 1000, key: () => "k" },
      handler: async () => ({ ok: true }),
    });
    const response = await route(new NextRequest("https://example.test/resource"));
    expect(response.status).toBe(429);
    expect((await response.json()).error.code).toBe("RATE_LIMITED");
  });

  // Issue #627 — `/api/v1` is the documented cross-origin surface, and a third
  // party that gets a bare 429 has to invent its own backoff.
  it("publishes the limiter's own reset as Retry-After", async () => {
    vi.spyOn(rateLimitModule, "checkRateLimit").mockRejectedValue(
      new AppError("RATE_LIMITED", "Too many requests. Please try again shortly.", { retryAfterSeconds: 42 }),
    );
    const route = defineHandler({
      auth: publicGuard,
      input: z.object({}),
      rateLimit: { limit: 1, windowMs: 1000, key: () => "k" },
      handler: async () => ({ ok: true }),
    });
    const response = await route(new NextRequest("https://example.test/resource"));
    expect(response.headers.get("retry-after")).toBe("42");
  });

  // A limiter that cannot compute a reset says nothing rather than guessing:
  // an invented number sends the caller back early or holds them out too long.
  it("omits Retry-After when the throw site did not know the reset", async () => {
    vi.spyOn(rateLimitModule, "checkRateLimit").mockRejectedValue(new AppError("RATE_LIMITED", "Too many requests."));
    const route = defineHandler({
      auth: publicGuard,
      input: z.object({}),
      rateLimit: { limit: 1, windowMs: 1000, key: () => "k" },
      handler: async () => ({ ok: true }),
    });
    const response = await route(new NextRequest("https://example.test/resource"));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBeNull();
  });

  // A missing `rate_limit_buckets` table (deploy landing ahead of its
  // migration) or any other plumbing failure in the limiter itself must not
  // turn every request into a 500 — the request proceeds, degraded but
  // answered, same as any other best-effort abuse guard being unavailable.
  it("degrades to letting the request through when the limiter's own storage fails", async () => {
    vi.spyOn(rateLimitModule, "checkRateLimit").mockRejectedValue(new Error('relation "rate_limit_buckets" does not exist'));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const route = defineHandler({
      auth: publicGuard,
      input: z.object({}),
      rateLimit: { limit: 1, windowMs: 1000, key: () => "k" },
      handler: async () => ({ ok: true }),
    });
    const response = await route(new NextRequest("https://example.test/resource"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { ok: true } });
  });
});

describe("route attribution (issue #626)", () => {
  it("replaces param values with their placeholders and names the owning feature", () => {
    expect(routeIdentity("/api/internal/forms/9d2a/fields/7", { formId: "9d2a", fieldId: "7" })).toEqual({
      route: "/api/internal/forms/[formId]/fields/[fieldId]",
      feature: "forms",
    });
  });

  it("collapses a catch-all's segments back into the single route it declares", () => {
    expect(routeIdentity("/api/auth/reset-password/abc123", { action: ["reset-password", "abc123"] })).toEqual({
      route: "/api/auth/[...action]",
      feature: "auth",
    });
  });

  it("keeps the public API's failures under the one name its hand-rolled routes already log", () => {
    expect(routeIdentity("/api/v1/events/pycon/schedule", { slug: "pycon" })).toEqual({
      route: "/api/v1/events/[slug]/schedule",
      feature: "api-v1",
    });
  });

  it("names a non-internal scope after itself", () => {
    expect(routeIdentity("/api/uploads/presign", {})).toEqual({ route: "/api/uploads/presign", feature: "uploads" });
  });
});

describe("request correlation (issue #632)", () => {
  it("returns the request id to the caller on success and on failure", async () => {
    const route = defineHandler({ auth: publicGuard, input: z.object({}), handler: async () => ({ ok: true }) });
    const ok = await route(new NextRequest("https://example.test/resource", { headers: { "cf-ray": "ray-77" } }));
    expect(ok.headers.get("x-request-id")).toBe("ray-77");

    const failing = defineHandler({
      auth: publicGuard,
      input: z.object({}),
      handler: async () => { throw new AppError("CONFLICT", "Already exists"); },
    });
    const conflict = await failing(new NextRequest("https://example.test/resource", { headers: { "cf-ray": "ray-78" } }));
    expect(conflict.headers.get("x-request-id")).toBe("ray-78");
  });

  // Off Cloudflare there is no `cf-ray` for the caller to fish out of the
  // response, which is exactly the case that had no correlator at all.
  it("returns the minted fallback id when no cf-ray is present", async () => {
    const route = defineHandler({ auth: publicGuard, input: z.object({}), handler: async () => ({ ok: true }) });
    const response = await route(new NextRequest("https://example.test/resource"));
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });
});
