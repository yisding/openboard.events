import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  ADMIN_COOKIE,
  adminCookieOptions,
  authenticateAdmin,
  clearAdminLoginThrottle,
  signAdminToken,
  throttleAdminLogin,
} from "@/features/auth";
import { isAppError } from "@/shared/lib/errors";
import { getEnv } from "@/shared/lib/env";

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
  if (!result.ok) return unauthorized();
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
    if (response.ok && attemptKey) await clearAdminLoginThrottle(attemptKey);
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
        if (response.status === 200 && attemptKey) await clearAdminLoginThrottle(attemptKey);
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
  if (betterAuth) return betterAuthHandler(request);
  return NextResponse.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
}

export async function GET(request: NextRequest) {
  // Only Better Auth serves GETs here — the OAuth callback, `get-session`, and
  // the email-verification link. The fallback has no GET surface at all.
  if (getEnv().ADMIN_AUTH_PROVIDER !== "better-auth") {
    return NextResponse.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
  }
  return betterAuthHandler(request);
}
