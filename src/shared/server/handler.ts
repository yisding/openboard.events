import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/db/client";
import { apiErrorSchema, eventIdSchema, type EventId, type UserId } from "@/shared/contracts";
import { captureError } from "@/shared/lib/error-tracking";
import { AppError, isAppError, retryAfterSeconds, toHttp } from "@/shared/lib/errors";
import { log } from "@/shared/lib/log";
import { assertSameOrigin } from "./csrf";
import { checkRateLimit } from "./rate-limit";

export type RouteParams = Record<string, string | string[] | undefined>;
/**
 * `impersonatedByUserId` is the organizer behind a speaker's portal session
 * ("Open portal as Ada"). The guard is the only place that identity is
 * available, so dropping it there left every mutation a mutation by nobody:
 * a task finished by an organizer standing in for a speaker was
 * indistinguishable from one the speaker finished themselves. Carried on the
 * session so a route can persist it as the actor of record.
 */
export type AuthSession = { actorId: string; role: string; eventId?: EventId; impersonatedByUserId?: UserId | null } | null;
/**
 * `csrfExempt` marks guards that never rely on an ambient browser credential
 * (cookies) for the caller's identity — today `apiKeyAuth` (bearer token).
 * It cannot be forged by a cross-site page the way a cookie-authenticated request can, so
 * `defineHandler`'s origin check skips them; every other guard (including
 * `publicAuth`) is checked. Set on the returned guard function itself
 * (`Object.assign`) rather than threaded through `defineHandler`'s options,
 * so the exemption lives next to the guard it describes.
 */
export type AuthGuard = ((request: NextRequest, eventId: EventId | null, params: RouteParams) => Promise<AuthSession>) & { csrfExempt?: boolean };
export type HandlerGuard = AuthGuard;

type HandlerContext<Input> = {
  eventId: EventId | null;
  session: AuthSession;
  input: Input;
  params: RouteParams;
  req: NextRequest;
  requestId: string;
};

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export type ErrorEnvelopeContext = {
  requestId: string;
  /** Groups the log line and the captured error, e.g. `"api"`, `"uploads"`, `"api-v1"`. */
  feature: string;
  /**
   * The route *pattern* (`/api/internal/forms/[formId]/fields`), never the
   * concrete path. `operational_error_buckets` keys on it, so a concrete path
   * would mint one row per tenant and defeat the aggregation.
   */
  route?: string;
  eventId?: EventId | null;
  /** Log message, for routes that name their failure something other than a request. */
  msg?: string;
  durationMs?: number;
  /**
   * Replaces the generic wire copy for an unrecognized throw. The portal
   * sign-in routes speak to a speaker mid-flow and say "Enter a valid code"
   * rather than "Request validation failed"; the capture and the status
   * mapping are unaffected either way.
   */
  fallbackMessages?: { validation?: string; internal?: string };
};

/**
 * The failure half of `defineHandler`, extracted so the handful of routes that
 * legitimately cannot use `defineHandler` — a raw `text/csv` body, a bare-array
 * `data` with a sibling `meta`, a signature-verified webhook — still capture,
 * log, and answer identically.
 *
 * Capturing is the part that kept being dropped by hand-rolled copies: without
 * it a 500 never reaches `operational_error_buckets`, so `/api/health`'s
 * `errors.recentCount` stays zero and the pager documented in
 * `docs/runbooks/alerting.md` never fires for that route.
 */
export function errorEnvelope(
  error: unknown,
  context: ErrorEnvelopeContext,
): { envelope: z.infer<typeof apiErrorSchema>; status: number; headers: Record<string, string> } {
  const appError = isAppError(error)
    ? error
    : error instanceof z.ZodError
      ? new AppError("VALIDATION", context.fallbackMessages?.validation ?? "Request validation failed")
      : new AppError("INTERNAL", context.fallbackMessages?.internal ?? "Unexpected server error");
  const envelope = apiErrorSchema.parse({
    error: error instanceof z.ZodError
      ? { code: appError.code, message: appError.message, fieldErrors: zodFieldErrors(error) }
      : {
          code: appError.code,
          message: appError.message,
          data: appError.details,
          ...(appError.fieldErrors ? { fieldErrors: appError.fieldErrors } : {}),
        },
  });
  // Capture the raw error — message and stack — before it is ever mapped down
  // to the generic envelope the caller sees. Without this, every unmapped
  // INTERNAL is a blind 500 (PLAN P3-OPS release-gate item 5).
  if (appError.code === "INTERNAL") {
    captureError(error, {
      requestId: context.requestId,
      feature: context.feature,
      code: appError.code,
      ...(context.route ? { route: context.route } : {}),
      ...(context.eventId ? { eventId: context.eventId } : {}),
    });
  }
  log({
    level: appError.code === "INTERNAL" ? "error" : "warn",
    msg: context.msg ?? "request.failed",
    code: appError.code,
    requestId: context.requestId,
    feature: context.feature,
    ...(context.route ? { route: context.route } : {}),
    ...(context.eventId ? { eventId: context.eventId } : {}),
    ...(context.durationMs === undefined ? {} : { durationMs: context.durationMs }),
  });
  const retryAfter = retryAfterSeconds(appError);
  return {
    envelope,
    status: toHttp(appError.code),
    headers: {
      // Support reports arrive as "it failed at about 2pm". The correlator has
      // always existed server-side — `error.captured` logs it — but never
      // reached the person who saw the failure, and off Cloudflare (the
      // `crypto.randomUUID()` fallback) there was no `cf-ray` to fish out of
      // the response either.
      "x-request-id": context.requestId,
      ...(retryAfter === undefined ? {} : { "retry-after": String(retryAfter) }),
    },
  };
}

/**
 * The route *pattern* behind a concrete request path, plus the feature that
 * owns it: `/api/internal/forms/9d2…/fields/7` becomes
 * `/api/internal/forms/[formId]/fields/[fieldId]` and `forms`.
 *
 * Both are derived rather than declared. `defineHandler` labelled every one of
 * its ~158 routes `feature: "api"` and dropped `route` entirely, so a paged
 * operator reading `operational_error_buckets` could not name the endpoint
 * that broke; declaring the name at each of those 158 call sites would be a
 * name repeated 158 times, which is a name that drifts. The path already
 * states it — `/api/internal/<feature>/…` is the layout of the whole tree.
 *
 * The *pattern* is what makes the bucket groupable: bucketing on the concrete
 * path would mint one row per tenant and defeat the aggregation the table
 * exists for.
 */
export function routeIdentity(pathname: string, params: RouteParams): { route: string; feature: string } {
  const placeholders = new Map<string, string>();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") placeholders.set(value, `[${key}]`);
    else if (Array.isArray(value)) for (const segment of value) placeholders.set(segment, `[...${key}]`);
  }
  const segments: string[] = [];
  for (const segment of pathname.split("/")) {
    const normalized = placeholders.get(segment) ?? segment;
    // A catch-all spreads across as many segments as the caller sent
    // (`/api/auth/reset-password/abc`); collapse them back into the single
    // `[...action]` the file-system route actually declares.
    if (normalized.startsWith("[...") && segments.at(-1) === normalized) continue;
    segments.push(normalized);
  }
  return { route: segments.join("/").slice(0, 200), feature: featureOfRoute(segments) };
}

function featureOfRoute(segments: string[]): string {
  // `["", "api", "internal", "forms", …]` -> scope `internal`, area `forms`.
  const [scope, area] = segments.filter(Boolean).slice(1);
  if (!scope) return "api";
  // `/api/v1` keeps the name its hand-rolled routes already log under, so the
  // public API's failures stay one searchable group across both styles.
  if (scope === "v1") return "api-v1";
  if (scope !== "internal") return scope;
  // A parameterized first segment would be a per-tenant "feature" name; there
  // is no such route today, and `api` is the honest answer if one appears.
  return area && !area.startsWith("[") ? area : "api";
}

function queryInput(searchParams: URLSearchParams): Record<string, string | string[]> {
  const input: Record<string, string | string[]> = {};
  for (const key of new Set(searchParams.keys())) {
    const values = searchParams.getAll(key);
    input[key] = values.length === 1 ? values[0] ?? "" : values;
  }
  return input;
}

async function bodyInput(request: NextRequest): Promise<unknown> {
  const body = await request.text();
  if (body.trim().length === 0) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw new AppError("VALIDATION", "Request body must be valid JSON");
  }
}

function zodFieldErrors(error: z.ZodError): Record<string, string> {
  const flattened = z.flattenError(error).fieldErrors as Record<string, string[] | undefined>;
  return Object.fromEntries(
    Object.entries(flattened).flatMap(([field, messages]) => messages?.[0] ? [[field, messages[0]]] : []),
  );
}

export function defineHandler<Input, Output>(options: {
  auth: AuthGuard;
  input: z.ZodType<Input>;
  /**
   * Opt-in application rate limit (PLAN P3-SEC), enforced after auth (so the
   * key may use the resolved session/eventId) and before the handler body
   * runs. `key` should incorporate everything that should share one bucket —
   * an IP, a contact id, an API key id — so unrelated callers never share a
   * counter. Backed by `checkRateLimit` (DB-based; no paid rate-limit
   * service), which throws `RATE_LIMITED` (429) once `limit` is exceeded
   * inside `windowMs`.
   */
  rateLimit?: { limit: number; windowMs: number; key: (context: { request: NextRequest; eventId: EventId | null; session: AuthSession; params: RouteParams }) => string };
  handler: (context: HandlerContext<Input>) => Promise<Output>;
}) {
  return async (request: NextRequest, route?: { params?: Promise<RouteParams> }) => {
    const startedAt = Date.now();
    const requestId = request.headers.get("cf-ray") ?? crypto.randomUUID();
    let eventId: EventId | null = null;
    // Params are what turn ids back into placeholders, so the identity is
    // provisional until they resolve. They always do; this only keeps a throw
    // from `route.params` itself attributable rather than unlabelled.
    let identity = routeIdentity(request.nextUrl.pathname, {});
    try {
      const params = await route?.params ?? {};
      identity = routeIdentity(request.nextUrl.pathname, params);
      const rawEventId = params?.eventId;
      if (typeof rawEventId === "string") eventId = eventIdSchema.parse(rawEventId);
      if (MUTATING_METHODS.has(request.method) && !options.auth.csrfExempt) assertSameOrigin(request);
      const session = await options.auth(request, eventId, params);
      eventId ??= session?.eventId ?? null;
      if (options.rateLimit) {
        try {
          await checkRateLimit(db, {
            key: options.rateLimit.key({ request, eventId, session, params }),
            limit: options.rateLimit.limit,
            windowMs: options.rateLimit.windowMs,
          });
        } catch (error) {
          // A real over-limit rejection must still 429 — only the limiter's
          // own plumbing failing (missing `rate_limit_buckets` because a
          // deploy landed ahead of its migration, a transient DB hiccup) is
          // caught here. `checkRateLimit`'s own doc comment already treats
          // the counter as best-effort/non-authoritative; letting its
          // storage layer being unavailable turn into a hard 500 for every
          // caller would make an abuse guard a bigger outage risk than the
          // abuse it guards against.
          if (isAppError(error) && error.code === "RATE_LIMITED") throw error;
          captureError(error, { requestId, feature: identity.feature, route: identity.route, code: "RATE_LIMIT_DEGRADED", ...(eventId ? { eventId } : {}) });
          log({ level: "warn", msg: "rate_limit.degraded", requestId, feature: identity.feature, route: identity.route, ...(eventId ? { eventId } : {}) });
        }
      }
      const rawInput: unknown = request.method === "GET"
        ? queryInput(request.nextUrl.searchParams)
        : await bodyInput(request);
      const input = options.input.parse(rawInput);
      const data = await options.handler({ eventId, session, input, params, req: request, requestId });
      log({ level: "info", msg: "request.complete", requestId, feature: identity.feature, route: identity.route, ...(eventId ? { eventId } : {}), durationMs: Date.now() - startedAt });
      return NextResponse.json({ data }, { headers: { "x-request-id": requestId } });
    } catch (error) {
      const { envelope, status, headers } = errorEnvelope(error, {
        requestId,
        feature: identity.feature,
        route: identity.route,
        eventId,
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json(envelope, { status, headers });
    }
  };
}
