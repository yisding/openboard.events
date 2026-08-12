import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { safeInternalPath } from "@/features/auth/safe-next";
import { isAppError } from "@/shared/lib/errors";

const confirmEmailSchema = z.object({
  token: z.string().trim().min(1).max(4_096),
  next: z.string().optional(),
});

type BetterAuthRequestHandler = (request: Request) => Promise<Response>;

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
  betterAuthEnabled: boolean,
  handler: BetterAuthRequestHandler,
): Promise<Response> {
  if (!betterAuthEnabled) {
    return NextResponse.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
  }
  if (new URL(request.url).pathname.endsWith("/api/auth/verify-email")) {
    return NextResponse.redirect(emailConfirmationLandingUrl(request.url));
  }
  return handler(request);
}

export async function confirmAdminEmail(
  request: NextRequest,
  dependencies: {
    handler: BetterAuthRequestHandler;
    limit: () => Promise<void>;
  },
): Promise<NextResponse> {
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
