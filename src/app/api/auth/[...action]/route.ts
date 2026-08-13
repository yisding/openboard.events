import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/db/client";
import {
  ADMIN_COOKIE,
  adminCookieOptions,
  authenticateAdmin,
  clearAdminLoginThrottle,
  nudgeAdminAuthEmailOutbox,
  signAdminToken,
  throttleAdminLogin,
} from "@/features/auth";
import { isAppError, toHttp } from "@/shared/lib/errors";
import { getEnv } from "@/shared/lib/env";
import { assertSameOrigin } from "@/shared/server/csrf";
import { checkRateLimit } from "@/shared/server/rate-limit";
import { beginGoogleSignup, confirmAdminEmail, handleAdminAuthGet, handleSocialSignIn } from "./_lib";

/**
 * Admin auth endpoints.
 *
 * This was a single-segment `[action]` route while admin auth was the
 * jose/PBKDF2 fallback, which only ever needed `sign-in` and `sign-out`. M42
 * widened it to a catch-all because Better Auth's surface is multi-segment
 * (`/sign-in/email`, `/callback/google`, `/get-session`, `/reset-password/…`),
 * and Next.js will not accept `[action]` and `[...action]` side by side.
 *
 * The two legacy paths keep their exact request and response shapes on both
 * providers — `POST /api/auth/sign-in` with `{email, password}` answering
 * `{data:{signedIn:true}}` — so `LoginForm`, the e2e specs and the deployed
 * smoke script are unaffected by which provider is switched on.
 */

const signInSchema = z.object({ email: z.email(), password: z.string().min(8).max(256) });
const unauthorized = () => NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Invalid email or password" } }, { status: 401 });

/**
 * Better Auth's *own* credential endpoints, reachable through the catch-all
 * below. `POST /api/auth/sign-in` (our stable legacy shape) delegates to
 * `/sign-in/email` in-process, but nothing stops a client — or an attacker —
 * from posting straight to the native path, and until this list existed those
 * requests skipped `throttleAdminLogin` entirely: `admin_login_attempts` was
 * never incremented, so the 15-minute block could never arm and Better Auth's
 * own 3-per-10s in-memory limiter (per-isolate on Workers) was the only
 * control left. Every password-guessable native path belongs here.
 */
const THROTTLED_BETTER_AUTH_PATHS = new Set(["sign-in/email"]);

type PublicEmailPolicy = { ipLimit: number; emailLimit: number; windowMs: number };
const PUBLIC_EMAIL_PATHS = new Map<string, PublicEmailPolicy>([
  ["sign-up/email", { ipLimit: 10, emailLimit: 4, windowMs: 60 * 60 * 1000 }],
  ["send-verification-email", { ipLimit: 20, emailLimit: 5, windowMs: 10 * 60 * 1000 }],
  ["request-password-reset", { ipLimit: 20, emailLimit: 5, windowMs: 10 * 60 * 1000 }],
]);

function clientIp(request: NextRequest): string {
  return request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "unknown";
}

async function betterAuthHandler(request: Request): Promise<Response> {
  const { getAdminAuth } = await import("@/features/auth/server/better-auth");
  return getAdminAuth().handler(request);
}

/**
 * Copy a Better Auth response's `Set-Cookie` headers onto our own envelope.
 * The session cookie is the entire point of the exchange; the body shape is
 * ours to keep stable.
 */
function withCookies(source: Response, body: unknown, status: number): NextResponse {
  const response = NextResponse.json(body, { status });
  for (const cookie of source.headers.getSetCookie()) response.headers.append("set-cookie", cookie);
  return response;
}

/** `POST /api/auth/sign-in` on the Better Auth provider. */
async function betterAuthSignIn(request: NextRequest, credentials: z.infer<typeof signInSchema>): Promise<NextResponse> {
  const url = new URL(request.url);
  url.pathname = "/api/auth/sign-in/email";
  const forwarded = new Request(url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify({ email: credentials.email, password: credentials.password }),
  });
  const result = await betterAuthHandler(forwarded);
  if (!result.ok) {
    const body = await result.json().catch(() => null) as { code?: string } | null;
    if (result.status === 403 && body?.code === "EMAIL_NOT_VERIFIED") {
      return NextResponse.json({ error: { code: "EMAIL_NOT_VERIFIED", message: "Confirm your email before signing in" } }, { status: 403 });
    }
    return unauthorized();
  }
  return withCookies(result, { data: { signedIn: true } }, 200);
}

async function betterAuthSignOut(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url);
  url.pathname = "/api/auth/sign-out";
  const forwarded = new Request(url, { method: "POST", headers: request.headers, body: "{}" });
  const result = await betterAuthHandler(forwarded);
  // A sign-out is idempotent from the caller's side: whether or not there was a
  // session to end, the caller is signed out afterwards.
  return withCookies(result, { data: { signedOut: true } }, 200);
}

function rateLimited(error: unknown): NextResponse | null {
  if (isAppError(error) && error.code === "RATE_LIMITED") {
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: 429 });
  }
  return null;
}

/**
 * Proxy a native Better Auth credential endpoint with the application-layer
 * throttle wrapped around it. The response is Better Auth's own, verbatim —
 * only the throttle is added, so a client that talks to the native surface
 * still gets the native contract.
 *
 * The body is read once and replayed, because `throttleAdminLogin` needs the
 * email before the handler consumes the stream. A body that does not parse as
 * a credential attempt is forwarded unthrottled: there is no key to count it
 * against, and Better Auth owns rejecting it.
 */
function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

async function throttledBetterAuthPost(request: NextRequest): Promise<Response> {
  const raw = await request.text();
  const parsed = signInSchema.safeParse(parseJson(raw));
  let attemptKey: string | undefined;
  try {
    if (parsed.success) attemptKey = await throttleAdminLogin(parsed.data.email, clientIp(request));
    const forwarded = new Request(request.url, { method: "POST", headers: request.headers, body: raw });
    const response = await betterAuthHandler(forwarded);
    const unverified = response.status === 403
      && (await response.clone().json().catch(() => null) as { code?: string } | null)?.code === "EMAIL_NOT_VERIFIED";
    // EMAIL_NOT_VERIFIED is reached only after the credential was accepted.
    // Do not let a user lock themselves out while looking for their link.
    if ((response.ok || unverified) && attemptKey) await clearAdminLoginThrottle(attemptKey);
    return response;
  } catch (error) {
    const limited = rateLimited(error);
    if (limited) return limited;
    throw error;
  }
}

function nudgeAuthMail(): void {
  try {
    const context = getCloudflareContext();
    nudgeAdminAuthEmailOutbox(context.ctx.waitUntil.bind(context.ctx));
  } catch {
    // `next dev` and unit tests have no Cloudflare execution context. Starting
    // the drain still makes log-mode activation usable; cron remains the
    // delivery guarantee in deployed environments.
    nudgeAdminAuthEmailOutbox(() => undefined);
  }
}

async function rateLimitedPublicEmailPost(request: NextRequest, path: string): Promise<Response> {
  const raw = await request.text();
  const parsed = parseJson(raw);
  const email = parsed && typeof parsed === "object" && typeof (parsed as { email?: unknown }).email === "string"
    ? (parsed as { email: string }).email.trim().toLowerCase()
    : null;
  const policy = PUBLIC_EMAIL_PATHS.get(path);
  try {
    if (policy) {
      const ip = clientIp(request);
      await checkRateLimit(db, { key: `auth-email:${path}:ip:${ip}`, limit: policy.ipLimit, windowMs: policy.windowMs });
      if (email && z.email().safeParse(email).success) {
        await checkRateLimit(db, { key: `auth-email:${path}:email:${email}`, limit: policy.emailLimit, windowMs: policy.windowMs });
      }
    }
    const response = await betterAuthHandler(new Request(request.url, { method: "POST", headers: request.headers, body: raw }));
    if (response.ok) nudgeAuthMail();
    return response;
  } catch (error) {
    const limited = rateLimited(error);
    if (limited) return limited;
    throw error;
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ action: string[] }> }) {
  const { action } = await context.params;
  const path = action.join("/");
  const env = getEnv();
  const betterAuth = env.ADMIN_AUTH_PROVIDER === "better-auth";

  try {
    // Every POST here either mints or clears an admin session cookie. The
    // fallback provider's `sign-in` branch below writes `ob_admin` straight
    // from the request body, and `SameSite=Lax` stops a cross-site form post's
    // cookie from being *sent*, not from being *stored* — so a forged login
    // would silently swap the organizer into the attacker's workspace. Reject
    // login CSRF once, before any branch reads a credential. Better Auth
    // validates origin itself, so this is harmlessly redundant on that path.
    assertSameOrigin(request);
  } catch (error) {
    if (isAppError(error)) {
      return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: toHttp(error.code) });
    }
    throw error;
  }

  if (path === "sign-out") {
    if (betterAuth) return betterAuthSignOut(request);
    const response = NextResponse.json({ data: { signedOut: true } });
    response.cookies.set(ADMIN_COOKIE, "", { ...adminCookieOptions(), maxAge: 0 });
    return response;
  }

  if (path === "sign-in") {
    const input = signInSchema.safeParse(await request.json().catch(() => null));
    if (!input.success) return unauthorized();
    // The application-layer throttle runs on both providers — see
    // `throttleAdminLogin`. On the fallback it is applied inside
    // `authenticateAdmin`; here it has to be applied around the delegation.
    let attemptKey: string | undefined;
    try {
      if (betterAuth) attemptKey = await throttleAdminLogin(input.data.email, clientIp(request));
      const identity = betterAuth ? null : await authenticateAdmin(input.data.email, input.data.password, clientIp(request));
      if (betterAuth) {
        const response = await betterAuthSignIn(request, input.data);
        if ((response.status === 200 || response.status === 403) && attemptKey) await clearAdminLoginThrottle(attemptKey);
        return response;
      }
      if (!identity) return unauthorized();
      const response = NextResponse.json({ data: { signedIn: true } });
      response.cookies.set(ADMIN_COOKIE, await signAdminToken(identity), adminCookieOptions());
      return response;
    } catch (error) {
      const limited = rateLimited(error);
      if (limited) return limited;
      throw error;
    }
  }

  if (betterAuth && THROTTLED_BETTER_AUTH_PATHS.has(path)) return throttledBetterAuthPost(request);
  if (betterAuth && path === "sign-up/google") return beginGoogleSignup(request, env, betterAuthHandler);
  if (betterAuth && path === "sign-in/social") return handleSocialSignIn(request, env, betterAuthHandler);
  if (betterAuth && path === "confirm-email") return confirmAdminEmail(request, {
    handler: betterAuthHandler,
    limit: () => checkRateLimit(db, {
      key: `auth-email:confirm-email:ip:${clientIp(request)}`,
      limit: 20,
      windowMs: 10 * 60 * 1000,
    }),
  });
  if (betterAuth && PUBLIC_EMAIL_PATHS.has(path)) return rateLimitedPublicEmailPost(request, path);
  if (betterAuth) return betterAuthHandler(request);
  return NextResponse.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
}

export async function GET(request: NextRequest) {
  // Only Better Auth serves GETs here — the OAuth callback, `get-session`, and
  // the email-verification link. The fallback has no GET surface at all.
  const env = getEnv();
  return handleAdminAuthGet(request, env.ADMIN_AUTH_PROVIDER === "better-auth", betterAuthHandler, env);
}
