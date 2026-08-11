import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { eventIdSchema } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { defineHandler } from "./handler";
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

  it("exempts a guard marked csrfExempt (cronAuth/apiKeyAuth's own contract)", async () => {
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
    expect(spy).toHaveBeenCalledTimes(1);
    const captured = JSON.parse(spy.mock.calls[0]?.[0] as string);
    expect(captured).toMatchObject({ level: "error", msg: "error.captured", code: "INTERNAL", error: "db pool exhausted" });
    expect(captured.stack).toContain("db pool exhausted");
  });

  it("captures an AppError explicitly thrown with code INTERNAL, keeping its real message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const route = defineHandler({
      auth: publicGuard,
      input: z.object({}),
      handler: async () => { throw new AppError("INTERNAL", "R2 credentials are not configured"); },
    });
    await route(new NextRequest("https://example.test/resource"));

    expect(spy).toHaveBeenCalledTimes(1);
    const captured = JSON.parse(spy.mock.calls[0]?.[0] as string);
    expect(captured.error).toBe("R2 credentials are not configured");
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
