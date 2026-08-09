import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, PORTAL_COOKIE_PREFIX } from "@/features/auth/cookies";
import { safeInternalPath } from "@/features/auth/safe-next";

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const requestPath = safeInternalPath(`${pathname}${request.nextUrl.search}`);
  if (pathname.startsWith("/events") && !request.cookies.has(ADMIN_COOKIE)) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", requestPath);
    return NextResponse.redirect(login);
  }
  const portalMatch = /^\/portal\/([^/]+)(?:\/|$)/u.exec(pathname);
  const isPortalAuthPage = pathname.endsWith("/login") || pathname.endsWith("/verify");
  const hasPortalCookie = request.cookies.getAll().some((cookie) => cookie.name.startsWith(PORTAL_COOKIE_PREFIX));
  if (portalMatch && !isPortalAuthPage && !hasPortalCookie) {
    const login = new URL(`/portal/${portalMatch[1]}/login`, request.url);
    login.searchParams.set("next", requestPath);
    return NextResponse.redirect(login);
  }
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-openboard-request-path", requestPath);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = { matcher: ["/events/:path*", "/portal/:path*"] };
