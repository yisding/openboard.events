import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/db/client";
import { apiErrorSchema, eventIdSchema, type EventId } from "@/shared/contracts";
import { captureError } from "@/shared/lib/error-tracking";
import { AppError, isAppError, toHttp } from "@/shared/lib/errors";
import { log } from "@/shared/lib/log";
import { checkRateLimit } from "./rate-limit";

export type RouteParams = Record<string, string | string[] | undefined>;
export type AuthSession = { actorId: string; role: string; eventId?: EventId } | null;
/**
 * `csrfExempt` marks guards that never rely on an ambient browser credential
 * (cookies) for the caller's identity — today `cronAuth` (shared-secret
 * header) and `apiKeyAuth` (bearer token). Those cannot be forged by a
 * cross-site page the way a cookie-authenticated request can, so
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

/**
 * Origin-header CSRF defense (PLAN P3-SEC): reject a state-changing request
 * whose `Origin` (or, failing that, `Referer`) names a different origin than
 * the one serving the request. A real cross-site forgery — a form or fetch
 * fired from an attacker's page against a signed-in browser's cookies —
 * always carries one of these headers naming the attacker's origin; a
 * same-origin call from this app's own client always carries one naming
 * this origin. Neither header is guaranteed from a non-browser caller (curl,
 * a test harness's HTTP client), so their total absence is allowed rather
 * than rejected — the routes this guards are cookie-session gated, and a
 * caller with no ambient browser credential to forge has nothing to steal.
 */
function assertSameOrigin(request: NextRequest): void {
  const declared = request.headers.get("origin") ?? request.headers.get("referer");
  if (!declared) return;
  let declaredOrigin: string;
  try {
    declaredOrigin = new URL(declared).origin;
  } catch {
    throw new AppError("FORBIDDEN", "Cross-origin request rejected");
  }
  if (declaredOrigin !== request.nextUrl.origin) {
    throw new AppError("FORBIDDEN", "Cross-origin request rejected");
  }
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
    try {
      const params = await route?.params ?? {};
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
          captureError(error, { requestId, feature: "api", code: "RATE_LIMIT_DEGRADED", ...(eventId ? { eventId } : {}) });
          log({ level: "warn", msg: "rate_limit.degraded", requestId, feature: "api", ...(eventId ? { eventId } : {}) });
        }
      }
      const rawInput: unknown = request.method === "GET"
        ? queryInput(request.nextUrl.searchParams)
        : await bodyInput(request);
      const input = options.input.parse(rawInput);
      const data = await options.handler({ eventId, session, input, params, req: request, requestId });
      log({ level: "info", msg: "request.complete", requestId, feature: "api", ...(eventId ? { eventId } : {}), durationMs: Date.now() - startedAt });
      return NextResponse.json({ data });
    } catch (error) {
      const appError = isAppError(error)
        ? error
        : error instanceof z.ZodError
          ? new AppError("VALIDATION", "Request validation failed")
          : new AppError("INTERNAL", "Unexpected server error");
      const envelope = apiErrorSchema.parse({
        error: error instanceof z.ZodError
          ? { code: appError.code, message: appError.message, fieldErrors: zodFieldErrors(error) }
          : { code: appError.code, message: appError.message, data: appError.details },
      });
      // Capture the raw error — message and stack — before it is ever mapped
      // down to the generic envelope the caller sees. Without this, every
      // unmapped INTERNAL is a blind 500: the log line below only ever
      // carries "Unexpected server error" (PLAN P3-OPS release-gate item 5).
      if (appError.code === "INTERNAL") {
        captureError(error, { requestId, feature: "api", code: appError.code, ...(eventId ? { eventId } : {}) });
      }
      log({ level: appError.code === "INTERNAL" ? "error" : "warn", msg: "request.failed", code: appError.code, requestId, feature: "api", ...(eventId ? { eventId } : {}), durationMs: Date.now() - startedAt });
      return NextResponse.json(envelope, { status: toHttp(appError.code) });
    }
  };
}
