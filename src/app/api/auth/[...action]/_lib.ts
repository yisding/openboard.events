import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { signupLegalConsent } from "@/features/auth/legal-consent";
import { safeInternalPath } from "@/features/auth/safe-next";
import { invitationTokenFromNextPath } from "@/features/auth/signup-context";
import { getOrganizationInvitationDestinationByToken } from "@/features/organizations";
import {
  OAUTH_SIGNUP_INTENT_COOKIE,
  oauthSignupIntentCookieOptions,
  sealOAuthSignupIntent,
} from "@/features/auth/server/oauth-signup-intent";
import { isAppError, toHttp } from "@/shared/lib/errors";
import type { RuntimeEnv } from "@/shared/lib/env";
import { assertSameOrigin } from "@/shared/server/csrf";

const confirmEmailSchema = z.object({
  token: z.string().trim().min(1).max(4_096),
  next: z.string().optional(),
});

const googleSignupSchema = z.object({
  organizationName: z.string().trim().max(160).optional(),
  invitationToken: z.string().trim().min(1).max(512).optional(),
  legalConsentAccepted: z.boolean().optional(),
  acceptedTermsVersion: z.string().trim().max(80).optional(),
  acknowledgedPrivacyVersion: z.string().trim().max(80).optional(),
  next: z.string().max(2_048).optional(),
});
const googleSocialSchema = z.object({ provider: z.literal("google") });

type BetterAuthRequestHandler = (request: Request) => Promise<Response>;

function expireOAuthSignupIntent(
  result: Response,
  env: Pick<RuntimeEnv, "APP_ENV">,
): NextResponse {
  const response = new NextResponse(result.body, {
    status: result.status,
    statusText: result.statusText,
    headers: result.headers,
  });
  response.cookies.set(OAUTH_SIGNUP_INTENT_COOKIE, "", {
    ...oauthSignupIntentCookieOptions(env),
    maxAge: 0,
  });
  return response;
}

function copyCookies(source: Response, target: NextResponse): void {
  for (const cookie of source.headers.getSetCookie()) target.headers.append("set-cookie", cookie);
}

function verificationNext(requestUrl: URL): string {
  const callback = requestUrl.searchParams.get("callbackURL");
  if (!callback) return "/organizations";
  const safeCallback = safeInternalPath(callback, "/organizations");
  const parsed = new URL(safeCallback, requestUrl.origin);
  return parsed.pathname === "/signup/verified"
    ? safeInternalPath(parsed.searchParams.get("next"), "/organizations")
    : safeCallback;
}

/** A scanner may follow this GET; it must only render a user-confirmation page. */
export function emailConfirmationLandingUrl(rawUrl: string): URL {
  const source = new URL(rawUrl);
  const destination = new URL("/signup/confirm", source.origin);
  const token = source.searchParams.get("token");
  if (token) destination.searchParams.set("token", token);
  destination.searchParams.set("next", verificationNext(source));
  return destination;
}

export async function handleAdminAuthGet(
  request: NextRequest,
  handler: BetterAuthRequestHandler,
  env?: Pick<RuntimeEnv, "APP_ENV">,
): Promise<Response> {
  if (new URL(request.url).pathname.endsWith("/api/auth/verify-email")) {
    return NextResponse.redirect(emailConfirmationLandingUrl(request.url));
  }
  const result = await handler(request);
  if (!new URL(request.url).pathname.endsWith("/api/auth/callback/google") || !env) return result;

  // The callback is the only request that can read this path-scoped cookie.
  // Expire it on every Google return — success, denial, or validation error —
  // so an abandoned signup context cannot bleed into a later OAuth attempt.
  return expireOAuthSignupIntent(result, env);
}

/** Keep an abandoned explicit-signup intent out of an ordinary Google flow. */
export async function handleSocialSignIn(
  request: NextRequest,
  env: Pick<RuntimeEnv, "APP_ENV">,
  handler: BetterAuthRequestHandler,
): Promise<Response> {
  const body = await request.clone().json().catch(() => null);
  const isGoogle = googleSocialSchema.safeParse(body).success;
  let forwarded: Request = request;
  if (isGoogle && body && typeof body === "object") {
    const headers = new Headers(request.headers);
    headers.delete("content-length");
    // This route is the ordinary sign-in door. Even a hand-written request
    // cannot turn it into account creation; `/sign-up/google` calls the Better
    // Auth handler directly with a sealed signup intent and requestSignUp=true.
    forwarded = new Request(request.url, {
      method: request.method,
      headers,
      body: JSON.stringify({ ...body, requestSignUp: false }),
    });
  }
  const result = await handler(forwarded);
  return isGoogle ? expireOAuthSignupIntent(result, env) : result;
}

function authError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

/**
 * Start an explicit Google *signup*, distinct from login's social sign-in.
 * The encrypted callback cookie binds the workspace/invitation and the exact
 * policies the user saw to the one browser completing the OAuth redirect.
 */
export async function beginGoogleSignup(
  request: NextRequest,
  env: RuntimeEnv,
  handler: BetterAuthRequestHandler,
  dependencies: {
    invitationDestinationByToken?: (token: string) => Promise<string | null>;
  } = {},
): Promise<NextResponse> {
  try {
    assertSameOrigin(request);
  } catch (error) {
    if (isAppError(error)) return authError(error.code, error.message, toHttp(error.code));
    throw error;
  }
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.SESSION_SECRET) {
    return authError("NOT_FOUND", "Google signup is not available", 404);
  }

  const input = googleSignupSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return authError("VALIDATION", "Check the signup details and try again", 400);
  const next = safeInternalPath(input.data.next, "/organizations");
  const invitationToken = input.data.invitationToken;
  const invitationFromNext = invitationTokenFromNextPath(next);
  const organizationName = input.data.organizationName?.trim();
  let provisioningContext: { invitationToken: string } | { organizationName: string };
  if (invitationFromNext) {
    if (organizationName || invitationToken !== invitationFromNext) {
      return authError("VALIDATION", "That invitation signup could not be verified", 400);
    }
    provisioningContext = { invitationToken };
  } else if (invitationToken) {
    return authError("VALIDATION", "That invitation signup could not be verified", 400);
  } else if (organizationName) {
    provisioningContext = { organizationName };
  } else {
    return authError("VALIDATION", "Enter an organization name", 400);
  }

  const legalConsent = signupLegalConsent(env);
  if (legalConsent && (
    input.data.legalConsentAccepted !== true
    || input.data.acceptedTermsVersion !== legalConsent.termsVersion
    || input.data.acknowledgedPrivacyVersion !== legalConsent.privacyVersion
  )) {
    return authError(
      "VALIDATION",
      "Agree to the current Terms of Service and acknowledge the Privacy Policy to create an account.",
      400,
    );
  }

  const intent = await sealOAuthSignupIntent({
    provider: "google",
    ...provisioningContext,
    legalVersions: legalConsent
      ? { termsVersion: legalConsent.termsVersion, privacyVersion: legalConsent.privacyVersion }
      : null,
  }, env.SESSION_SECRET);
  // Existing identities do not run the new-user provisioning hook, so they
  // still need the invitation URL to accept membership after OAuth. A newly
  // created identity consumes the token inside that hook and must not replay
  // it; Better Auth selects newUserCallbackURL for that branch.
  const callbackURL = next;
  let newUserCallbackURL = next;
  if (invitationFromNext) {
    const invitationDestination = await (
      dependencies.invitationDestinationByToken ?? getOrganizationInvitationDestinationByToken
    )(invitationFromNext);
    if (!invitationDestination) {
      return authError("VALIDATION", "That invitation is no longer valid — ask for a new one", 400);
    }
    newUserCallbackURL = invitationDestination;
  }
  const errorCallbackURL = `/signup?${new URLSearchParams({ next }).toString()}`;
  const forwardedUrl = new URL(request.url);
  forwardedUrl.pathname = "/api/auth/sign-in/social";
  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.delete("content-length");
  const result = await handler(new Request(forwardedUrl, {
    method: "POST",
    headers: forwardedHeaders,
    body: JSON.stringify({
      provider: "google",
      callbackURL,
      newUserCallbackURL,
      errorCallbackURL,
      requestSignUp: true,
    }),
  }));
  const response = new NextResponse(result.body, {
    status: result.status,
    statusText: result.statusText,
    headers: result.headers,
  });
  if (result.ok) {
    response.cookies.set(OAUTH_SIGNUP_INTENT_COOKIE, intent, oauthSignupIntentCookieOptions(env));
  }
  return response;
}

export async function confirmAdminEmail(
  request: NextRequest,
  dependencies: {
    handler: BetterAuthRequestHandler;
    limit: () => Promise<void>;
  },
): Promise<NextResponse> {
  try {
    // The token is also a login credential once verification creates the
    // session. Reject login CSRF before reading or consuming that credential.
    assertSameOrigin(request);
  } catch (error) {
    if (isAppError(error)) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: toHttp(error.code) },
      );
    }
    throw error;
  }
  const input = confirmEmailSchema.safeParse(Object.fromEntries((await request.formData()).entries()));
  const next = safeInternalPath(input.success ? input.data.next : null, "/organizations");
  const failed = (reason: string) => NextResponse.redirect(
    new URL(`/signup/verified?error=${encodeURIComponent(reason)}&next=${encodeURIComponent(next)}`, request.url),
    303,
  );
  if (!input.success) return failed("invalid");

  try {
    await dependencies.limit();
  } catch (error) {
    if (isAppError(error) && error.code === "RATE_LIMITED") return failed("rate-limited");
    throw error;
  }

  const verificationUrl = new URL(request.url);
  verificationUrl.pathname = "/api/auth/verify-email";
  verificationUrl.search = new URLSearchParams({ token: input.data.token }).toString();
  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.delete("content-length");
  forwardedHeaders.delete("content-type");
  const result = await dependencies.handler(new Request(verificationUrl, {
    method: "GET",
    headers: forwardedHeaders,
  }));
  if (!result.ok) return failed("invalid");

  const response = NextResponse.redirect(new URL(next, request.url), 303);
  copyCookies(result, response);
  return response;
}
