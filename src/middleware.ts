import { NextResponse, type NextRequest } from "next/server";
import { PORTAL_COOKIE_PREFIX, hasAdminSessionCookie } from "@/features/auth/cookies";
import { safeInternalPath } from "@/features/auth/safe-next";
import { isPublicPortalPage } from "@/features/portal/public-pages";

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const requestPath = safeInternalPath(`${pathname}${request.nextUrl.search}`);
  const cookieNames = request.cookies.getAll().map((cookie) => cookie.name);
  // This is a redirect convenience only. Server guards still resolve and
  // authorize the Better Auth session on every protected request.
  if (pathname.startsWith("/events") && !hasAdminSessionCookie(cookieNames)) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", requestPath);
    return NextResponse.redirect(login);
  }
  const portalMatch = /^\/portal\/([^/]+)(?:\/|$)/u.exec(pathname);
  const portalBase = portalMatch ? `/portal/${portalMatch[1]}` : null;
  const isPublicPage = portalBase !== null && isPublicPortalPage(pathname, portalBase);
  const hasPortalCookie = request.cookies.getAll().some((cookie) => cookie.name.startsWith(PORTAL_COOKIE_PREFIX));
  if (portalMatch && !isPublicPage && !hasPortalCookie) {
    const login = new URL(`/portal/${portalMatch[1]}/login`, request.url);
    login.searchParams.set("next", requestPath);
    return NextResponse.redirect(login);
  }
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-openboard-request-path", requestPath);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

// Every prefix whose pages read `x-openboard-request-path` must be listed here:
// outside the matcher the middleware never runs, the header is absent, and
// `safeInternalPath` silently returns its fallback — so a signed-out deep link
// into `/organizations/<id>/billing` sends the user to the org picker after
// signing in instead of back to the page they asked for.
export const config = {
  matcher: ["/events/:path*", "/portal/:path*", "/organizations/:path*", "/account/:path*"],
};
