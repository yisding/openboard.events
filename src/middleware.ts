import { NextResponse, type NextRequest } from "next/server";
import { PORTAL_COOKIE_PREFIX, hasAdminSessionCookie } from "@/features/auth/cookies";
import { safeInternalPath } from "@/features/auth/safe-next";
import { isCredentialFreeLocalDemo } from "@/shared/lib/env";

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const requestPath = safeInternalPath(`${pathname}${request.nextUrl.search}`);
  const localDemo = isCredentialFreeLocalDemo();
  const cookieNames = request.cookies.getAll().map((cookie) => cookie.name);
  // Either provider's session cookie opens the gate — see
  // `hasAdminSessionCookie`. Checking only the fallback's name redirected a
  // signed-in Better Auth admin back to `/login`, which `LoginForm`'s
  // `router.replace(next)` then bounced straight back into.
  if (!localDemo && pathname.startsWith("/events") && !hasAdminSessionCookie(cookieNames)) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", requestPath);
    return NextResponse.redirect(login);
  }
  const portalMatch = /^\/portal\/([^/]+)(?:\/|$)/u.exec(pathname);
  const portalBase = portalMatch ? `/portal/${portalMatch[1]}` : null;
  const isPortalAuthPage = portalBase !== null && (pathname === `${portalBase}/login` || pathname === `${portalBase}/verify`);
  const hasPortalCookie = request.cookies.getAll().some((cookie) => cookie.name.startsWith(PORTAL_COOKIE_PREFIX));
  if (!localDemo && portalMatch && !isPortalAuthPage && !hasPortalCookie) {
    const login = new URL(`/portal/${portalMatch[1]}/login`, request.url);
    login.searchParams.set("next", requestPath);
    return NextResponse.redirect(login);
  }
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-openboard-request-path", requestPath);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = { matcher: ["/events/:path*", "/portal/:path*"] };
